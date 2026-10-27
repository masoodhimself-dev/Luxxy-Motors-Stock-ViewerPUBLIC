import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod/v4";
import { pool } from "@workspace/db";
import { SaleWorkspaceError } from "@workspace/vehicle-meta";
import {
  lookupSaleCorrespondence,
  prepareSaleCorrespondence,
} from "./sale-correspondence";
import { canonicalCustomerPhone } from "@workspace/vehicle-meta";
import { currentDealerId } from "./tenant-context";
import { siteOrigin } from "./enquiry-links";
import { staffHasPermission, staffLabel } from "../middlewares/staff-auth";
class WhatsAppMessageError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const messageHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const confirmation = z
  .object({
    requestId: z.string().uuid(),
    enquiryId: z.string().uuid().optional(),
    saleId: z.string().uuid().optional(),
    newCustomer: z
      .object({
        name: z.string().trim().min(2).max(200),
        email: z
          .union([z.literal(""), z.string().trim().email().max(254)])
          .optional(),
      })
      .strict()
      .optional(),
    vehicleId: z.string().uuid().optional(),
    phone: z
      .string()
      .trim()
      .max(80)
      .refine((value) => Boolean(canonicalCustomerPhone(value))),
    message: z.string().min(1).max(40000),
    confirmed: z.literal(true),
  })
  .strict()
  .refine(
    (value) =>
      [value.enquiryId, value.newCustomer, value.saleId].filter(Boolean)
        .length === 1,
  );
export function whatsappConfirmationRouter() {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use((req, res, next) => {
    if (
      !staffHasPermission(req, "sales.manage") &&
      !staffHasPermission(req, "payments.record")
    ) {
      res.status(403).json({ error: "You cannot record customer messages." });
      return;
    }
    next();
  });
  router.get("/enquiries", async (req, res) => {
    const dealer = currentDealerId(),
      q = String(req.query.q || "")
        .trim()
        .slice(0, 120),
      id = String(req.query.id || "");
    const saleId = String(req.query.saleId || "");
    if (saleId && (!z.string().uuid().safeParse(saleId).success || id)) {
      res.status(400).json({ error: "Choose a valid sale." });
      return;
    }
    if (id && !z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Choose a valid enquiry." });
      return;
    }
    try {
      if (saleId) {
        const target = await lookupSaleCorrespondence(saleId);
        const entry = target.enquiryId
          ? (
              await pool.query(
                'SELECT id,customer_name AS "customerName",phone,email,vehicle_title AS "vehicleTitle",vehicle_id AS "vehicleId" FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid',
                [dealer, target.enquiryId],
              )
            ).rows[0]
          : null;
        res.json({
          enquiries: entry ? [entry] : [],
          saleCustomer: target.saleCustomer,
          canCreate: staffHasPermission(req, "sales.manage"),
        });
        return;
      }
      if (id) {
        // A sale or issued document can retain the enquiry id it originally
        // referenced. Resolve that link without exposing another dealer's rows.
        const visited = new Set<string>();
        let nextId = id;
        for (;;) {
          if (visited.has(nextId) || visited.size >= 10)
            throw new WhatsAppMessageError(
              "The merged enquiry needs review before sharing.",
              409,
            );
          visited.add(nextId);
          const entry = (
            await pool.query(
              'SELECT id,customer_name AS "customerName",phone,email,vehicle_title AS "vehicleTitle",vehicle_id AS "vehicleId",merged_into_id FROM enquiries WHERE dealer_id=$1 AND id=$2',
              [dealer, nextId],
            )
          ).rows[0];
          if (!entry) {
            res.json({
              enquiries: [],
              canCreate: staffHasPermission(req, "sales.manage"),
            });
            return;
          }
          if (entry.merged_into_id) {
            nextId = entry.merged_into_id;
            continue;
          }
          const { merged_into_id: _mergedIntoId, ...customer } = entry;
          res.json({
            enquiries: [
              {
                ...customer,
                ...(entry.id !== id ? { requestedEnquiryId: id } : {}),
              },
            ],
            canCreate: staffHasPermission(req, "sales.manage"),
          });
          return;
        }
      }
      const digits = q.replace(/\D/g, "");
      const rows = await pool.query(
        `SELECT id,customer_name AS "customerName",phone,email,vehicle_title AS "vehicleTitle",vehicle_id AS "vehicleId" FROM enquiries WHERE dealer_id=$1 AND merged_into_id IS NULL AND ($2='' OR id::text=$2) AND ($3='' OR strpos(lower(customer_name),lower($3))>0 OR strpos(lower(coalesce(email,'')),lower($3))>0 OR ($4<>'' AND (strpos(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),$4)>0 OR ($5<>'' AND strpos(CASE WHEN regexp_replace(coalesce(phone,''),'[^0-9]','','g') ~ '^0[1-9][0-9]{9}$' THEN '44'||substring(regexp_replace(phone,'[^0-9]','','g') from 2) ELSE regexp_replace(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'^00','') END,$5)>0)))) ORDER BY updated_at DESC,id LIMIT 20`,
        [dealer, id, q, digits, canonicalCustomerPhone(q).replace(/^\+/, "")],
      );
      res.json({
        enquiries: rows.rows,
        canCreate: staffHasPermission(req, "sales.manage"),
      });
    } catch (error) {
      res
        .status(
          error instanceof WhatsAppMessageError ||
            error instanceof SaleWorkspaceError
            ? error.status
            : 503,
        )
        .json({
          error:
            error instanceof WhatsAppMessageError ||
            error instanceof SaleWorkspaceError
              ? error.message
              : "Customer enquiries could not be loaded. Try again.",
        });
    }
  });
  router.post("/confirm-whatsapp", async (req, res) => {
    const parsed = confirmation.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          error:
            "Choose a customer enquiry, check the number and confirm the message was sent.",
        });
      return;
    }
    const data = parsed.data,
      dealer = currentDealerId(),
      fingerprint = messageHash(JSON.stringify(data));
    const client = await pool.connect();
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        client.release();
      }
    };
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `whatsapp-confirm:${data.requestId}`,
      ]);
      const existing = (
        await client.query(
          "SELECT dealer_id,enquiry_id,detail,occurred_at FROM enquiry_events WHERE id=$1",
          [data.requestId],
        )
      ).rows[0];
      if (existing) {
        if (
          existing.dealer_id !== dealer ||
          existing.detail?.confirmationFingerprint !== fingerprint
        )
          throw new WhatsAppMessageError(
            "This confirmation was already used for a different message.",
            409,
          );
        await client.query("COMMIT");
        release();
        res.json({
          enquiryId: existing.enquiry_id,
          confirmedAt: existing.occurred_at,
          replayed: true,
        });
        return;
      }
      if (!staffHasPermission(req, "sales.manage"))
        throw new WhatsAppMessageError(
          "You cannot record this type of message.",
          403,
        );
      let sharedVehicle: { id: string; title: string } | undefined;
      if (data.vehicleId) {
        sharedVehicle = (
          await client.query(
            "SELECT id,title FROM vehicles WHERE dealer_id=$1 AND id=$2",
            [dealer, data.vehicleId],
          )
        ).rows[0];
        if (!sharedVehicle)
          throw new WhatsAppMessageError("Vehicle not found.", 404);
      }
      let entry: any;
      const enquiryId = data.saleId
        ? await prepareSaleCorrespondence(data.saleId, client)
        : data.enquiryId;
      if (enquiryId) {
        entry = (
          await client.query(
            "SELECT * FROM enquiries WHERE dealer_id=$1 AND id=$2 FOR UPDATE",
            [dealer, enquiryId],
          )
        ).rows[0];
        if (!entry) throw new WhatsAppMessageError("Enquiry not found.", 404);
        const visited = new Set<string>();
        while (entry.merged_into_id) {
          if (visited.has(entry.id) || visited.size >= 10)
            throw new WhatsAppMessageError(
              "The merged enquiry needs review before confirming.",
              409,
            );
          visited.add(entry.id);
          entry = (
            await client.query(
              "SELECT * FROM enquiries WHERE dealer_id=$1 AND id=$2 FOR UPDATE",
              [dealer, entry.merged_into_id],
            )
          ).rows[0];
          if (!entry)
            throw new WhatsAppMessageError(
              "The linked enquiry could not be found.",
              409,
            );
        }
      } else {
        if (!staffHasPermission(req, "sales.manage"))
          throw new WhatsAppMessageError(
            "Ask a salesperson to create the customer enquiry first.",
            403,
          );
        let vehicle: any;
        if (data.vehicleId) {
          vehicle = (
            await client.query(
              "SELECT id,title FROM vehicles WHERE dealer_id=$1 AND id=$2",
              [dealer, data.vehicleId],
            )
          ).rows[0];
          if (!vehicle)
            throw new WhatsAppMessageError("Vehicle not found.", 404);
        }
        entry = (
          await client.query(
            `INSERT INTO enquiries(id,dealer_id,customer_name,email,phone,type,status,message,source,preferred_contact,vehicle_id,vehicle_title) VALUES($1,$2,$3,$4,$5,'general','contacted','Staff-created enquiry for a WhatsApp conversation.','whatsapp','whatsapp',$6,$7) RETURNING *`,
            [
              randomUUID(),
              dealer,
              data.newCustomer!.name,
              data.newCustomer!.email || null,
              data.phone,
              vehicle?.id || null,
              vehicle?.title || null,
            ],
          )
        ).rows[0];
      }
      if (data.saleId) {
        if (
          data.vehicleId &&
          entry.vehicle_id &&
          data.vehicleId !== entry.vehicle_id
        )
          throw new WhatsAppMessageError(
            "The message vehicle does not match this sale.",
            409,
          );
        if (entry.vehicle_id)
          sharedVehicle = (
            await client.query(
              "SELECT id,title FROM vehicles WHERE dealer_id=$1 AND id=$2",
              [dealer, entry.vehicle_id],
            )
          ).rows[0];
      }
      const note = `Staff confirmed sent on WhatsApp (delivery not verified).\nTo: ${canonicalCustomerPhone(data.phone)}\n${data.message}`;
      const created = (
        await client.query(
          `INSERT INTO enquiry_events(id,dealer_id,enquiry_id,vehicle_id,vehicle_title,vehicle_url,kind,actor,summary,detail) VALUES($1,$2,$3,$4,$5,$6,'conversation_logged','dealer','WhatsApp sent — staff confirmed',$7::jsonb) RETURNING occurred_at`,
          [
            data.requestId,
            dealer,
            entry.id,
            sharedVehicle ? sharedVehicle.id : entry.vehicle_id,
            sharedVehicle ? sharedVehicle.title : entry.vehicle_title,
            sharedVehicle
              ? `${siteOrigin()}/vehicle/${sharedVehicle.id}`
              : entry.vehicle_url,
            JSON.stringify({
              channel: "whatsapp",
              staffId: req.staff!.authUserId,
              staffName: staffLabel(req),
              note,
              recipientPhone: canonicalCustomerPhone(data.phone),
              message: data.message,
              attachmentNames: [],
              confirmationFingerprint: fingerprint,
              deliveryVerified: false,
            }),
          ],
        )
      ).rows[0];
      await client.query(
        "UPDATE enquiries SET status=CASE WHEN status='new' THEN 'contacted'::enquiry_status ELSE status END,workspace_revision=workspace_revision+1,updated_at=now() WHERE dealer_id=$1 AND id=$2",
        [dealer, entry.id],
      );
      await client.query("COMMIT");
      release();
      res
        .status(201)
        .json({
          enquiryId: entry.id,
          confirmedAt: created.occurred_at,
          replayed: false,
        });
    } catch (error) {
      if (!released) await client.query("ROLLBACK");
      res
        .status(
          error instanceof WhatsAppMessageError ||
            error instanceof SaleWorkspaceError
            ? error.status
            : 503,
        )
        .json({
          error:
            error instanceof WhatsAppMessageError ||
            error instanceof SaleWorkspaceError
              ? error.message
              : "The sent confirmation could not be saved. Retry this confirmation; do not send the message again.",
        });
    } finally {
      release();
    }
  });
  return router;
}
