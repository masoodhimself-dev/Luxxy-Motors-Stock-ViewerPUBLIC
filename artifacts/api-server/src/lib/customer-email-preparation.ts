import { SaleWorkspaceError } from "@workspace/vehicle-meta";
import { prepareSaleCorrespondence } from "./sale-correspondence";
import { Router } from "express";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { canonicalCustomerPhone } from "@workspace/vehicle-meta";
import { currentDealerId } from "./tenant-context";
import { staffHasPermission } from "../middlewares/staff-auth";
import { createHash } from "node:crypto";
class EmailPreparationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const preparationHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const email = z.union([
  z.literal(""),
  z.string().trim().toLowerCase().email().max(254),
]);
const request = z
  .object({
    requestId: z.string().uuid(),
    enquiryId: z.string().uuid().optional(),
    saleId: z.string().uuid().optional(),
    newCustomer: z
      .object({
        name: z.string().trim().min(2).max(200),
        email: email.optional(),
      })
      .strict()
      .optional(),
    vehicleId: z.string().uuid().optional(),
    phone: z
      .string()
      .trim()
      .max(80)
      .refine((v) => !v || Boolean(canonicalCustomerPhone(v)))
      .optional(),
    email: email.optional(),
  })
  .strict()
  .refine(
    (v) => [v.enquiryId, v.newCustomer, v.saleId].filter(Boolean).length === 1,
  );
export function customerEmailPreparationRouter() {
  const router = Router();
  router.post("/email-enquiry", async (req, res) => {
    if (!staffHasPermission(req, "sales.manage")) {
      res
        .status(403)
        .json({ error: "Ask a salesperson to prepare this enquiry email." });
      return;
    }
    const parsed = request.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Choose an enquiry or enter the new customer details before preparing an email.",
      });
      return;
    }
    const data = parsed.data,
      dealer = currentDealerId(),
      fingerprint = preparationHash(JSON.stringify(data));
    const connect = () => pool.connect();
    let c: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      c = await pool.connect();
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `email-preparation:${data.requestId}`,
      ]);
      const existing = (
        await c.query("SELECT * FROM customer_email_preparations WHERE id=$1", [
          data.requestId,
        ])
      ).rows[0];
      if (
        existing &&
        (existing.dealer_id !== dealer ||
          existing.fingerprint !== fingerprint ||
          existing.created_by !== req.staff!.authUserId)
      )
        throw new EmailPreparationError(
          "This email preparation was already used for different details.",
          409,
        );
      let id =
          existing?.enquiry_id ||
          (data.saleId
            ? await prepareSaleCorrespondence(data.saleId, c)
            : data.enquiryId),
        entry: any;
      if (id) {
        const visited = new Set<string>();
        for (;;) {
          entry = (
            await c.query(
              "SELECT * FROM enquiries WHERE dealer_id=$1 AND id=$2 FOR UPDATE",
              [dealer, id],
            )
          ).rows[0];
          if (!entry)
            throw new EmailPreparationError("Enquiry not found.", 404);
          if (!entry.merged_into_id) break;
          if (visited.has(entry.id) || visited.size >= 10)
            throw new EmailPreparationError(
              "The merged enquiry needs review.",
              409,
            );
          visited.add(entry.id);
          id = entry.merged_into_id;
        }
      } else {
        const recipient = data.email || data.newCustomer!.email || "",
          phone = data.phone ? canonicalCustomerPhone(data.phone) : "";
        if (!recipient && !phone)
          throw new EmailPreparationError(
            "Enter a customer email address or phone number.",
            400,
          );
        let vehicle: any;
        if (data.vehicleId) {
          vehicle = (
            await c.query(
              "SELECT id,title FROM vehicles WHERE dealer_id=$1 AND id=$2",
              [dealer, data.vehicleId],
            )
          ).rows[0];
          if (!vehicle) throw new EmailPreparationError("Car not found.", 404);
        }
        entry = (
          await c.query(
            "INSERT INTO enquiries(id,dealer_id,customer_name,email,phone,type,status,message,source,preferred_contact,vehicle_id,vehicle_title) VALUES($1,$2,$3,$4,$5,'general','new','Staff-created enquiry. Email prepared for staff review.','staff',$6,$7,$8) RETURNING *",
            [
              randomUUID(),
              dealer,
              data.newCustomer!.name,
              recipient || null,
              phone || null,
              recipient ? "email" : "phone",
              vehicle?.id || null,
              vehicle?.title || null,
            ],
          )
        ).rows[0];
      }
      if (!existing)
        await c.query(
          "INSERT INTO customer_email_preparations(id,dealer_id,enquiry_id,fingerprint,created_by) VALUES($1,$2,$3,$4,$5)",
          [
            data.requestId,
            dealer,
            entry.id,
            fingerprint,
            req.staff!.authUserId,
          ],
        );
      await c.query("COMMIT");
      res.status(existing ? 200 : 201).json({
        enquiry: { id: entry.id, customerName: entry.customer_name },
        customerEmail: data.email || entry.email || "",
        replayed: Boolean(existing),
      });
    } catch (e) {
      if (c) await c.query("ROLLBACK");
      res
        .status(
          e instanceof EmailPreparationError || e instanceof SaleWorkspaceError
            ? e.status
            : 503,
        )
        .json({
          error:
            e instanceof EmailPreparationError ||
            e instanceof SaleWorkspaceError
              ? e.message
              : "The customer email could not be prepared. Retry the same preparation; nothing was sent.",
        });
    } finally {
      c?.release();
    }
  });
  return router;
}
