import { archiveSaleDocument } from "../lib/sale-document-pdf";
import { Router } from "express";
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  enquiriesTable,
  enquiryEmailsTable,
  enquiryEventsTable,
  vehiclesTable,
} from "@workspace/db";
import {
  defaultEmailTemplates,
  renderEmailTemplate,
  vehicleRegistrationLabel,
  type EmailFacts,
  type SaleWorkspaceDocument,
} from "@workspace/vehicle-meta";
import {
  requireStaff,
  requirePermission,
  staffLabel,
} from "../middlewares/staff-auth";
import { currentDealerId, currentTenant } from "../lib/tenant-context";
import {
  dealerIntegrationsStore,
  effectiveResendSettings,
  integrationReadiness,
  type PrivateDealerSettings,
} from "../lib/dealer-integrations-store";
import { sendEmailWithSettings } from "../lib/email-provider";
import { dealerProfile } from "../lib/enquiry-notifications";
import { siteOrigin } from "../lib/enquiry-links";

const draftSchema = z
  .object({
    to: z.string().trim().toLowerCase().max(254).email(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((v) => !/[\r\n\u0000-\u001f\u007f]/.test(v)),
    message: z
      .string()
      .trim()
      .min(1)
      .max(12000)
      .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)),
    includeVehicle: z.boolean(),
    includeAppointment: z.boolean(),
    photoIds: z
      .array(z.string().uuid())
      .max(6)
      .refine((v) => new Set(v).size === v.length),
    documentIds: z
      .array(z.string().regex(/^[a-f0-9-]{36}:[a-f0-9-]{36}$/i))
      .max(3)
      .refine((v) => new Set(v).size === v.length)
      .default([]),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
const sendSchema = draftSchema.extend({
  requestId: z.string().uuid(),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
});
type Draft = z.infer<typeof draftSchema>;
class EmailError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const uuid = (value: unknown): value is string =>
  z.string().uuid().safeParse(value).success;
const key = (dealer: string, id: string) => `enquiry-email:${dealer}:${id}`;
const describe = (row: typeof enquiryEmailsTable.$inferSelect) => ({
  id: row.id,
  requestId: row.requestId,
  to: row.recipient,
  subject: row.subject,
  status: row.status,
  photoCount: row.photoIds.length,
  documentCount: row.documentIds.length,
  createdAt: row.createdAt,
  finishedAt: row.finishedAt,
  error: row.error,
});
const dependencies = {
  settings: () => dealerIntegrationsStore.readPrivate(),
  send: sendEmailWithSettings,
};

/** Provider is injectable: tests only send to a recording transport. */
export function createEnquiryEmailRouter(
  overrides: Partial<typeof dependencies> = {},
) {
  const deps = { ...dependencies, ...overrides },
    router = Router();
  router.use(
    "/staff/enquiries/:id/email-context",
    requireStaff,
    requirePermission("sales.manage"),
  );
  router.use(
    "/staff/enquiries/:id/email-preview",
    requireStaff,
    requirePermission("sales.manage"),
  );
  router.use(
    "/staff/enquiries/:id/email",
    requireStaff,
    requirePermission("sales.manage"),
  );
  router.use("/staff/enquiries/:id/email{*rest}", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store, private");
    const origin = req.get("origin");
    let sameDealerOrigin = !origin;
    if (origin) {
      try {
        const source = new URL(origin),
          canonical = new URL(siteOrigin());
        sameDealerOrigin =
          !source.username &&
          !source.password &&
          source.origin === origin &&
          (source.origin === canonical.origin ||
            (currentTenant()?.kind === "website" &&
              source.protocol === canonical.protocol &&
              source.host.toLowerCase() ===
                (req.get("host") || "").toLowerCase()));
      } catch {
        sameDealerOrigin = false;
      }
    }
    if (!sameDealerOrigin) {
      res
        .status(403)
        .json({ error: "Open enquiry emails from this dealership website." });
      return;
    }
    next();
  });
  async function entry(id: string, executor: typeof db = db) {
    if (!uuid(id)) throw new EmailError("Enquiry not found.", 404);
    const [row] = await executor
      .select()
      .from(enquiriesTable)
      .where(
        and(
          eq(enquiriesTable.id, id),
          eq(enquiriesTable.dealerId, currentDealerId()),
        ),
      );
    if (!row) throw new EmailError("Enquiry not found.", 404);
    return row;
  }
  async function invoiceAttachments(
    enquiry: typeof enquiriesTable.$inferSelect,
    executor: typeof db = db,
    content = false,
  ) {
    if (!enquiry.vehicleId) return [];
    const rows = (
      await executor.execute(
        sql`SELECT id,state->'documents' AS documents,CASE WHEN ${content} THEN state->'documentArchives' ELSE NULL END AS archives FROM sale_workspace WHERE dealer_id=${enquiry.dealerId} AND state#>>'{draft,vehicleId}'=${enquiry.vehicleId} AND (state#>>'{draft,sourceEnquiryId}'=${enquiry.id} OR (${enquiry.email ?? ""}<>'' AND lower(state#>>'{draft,email}')=lower(${enquiry.email ?? ""}))) ORDER BY updated_at DESC LIMIT 20`,
      )
    ).rows;
    return rows
      .flatMap((row) =>
        ((row.documents ?? []) as SaleWorkspaceDocument[])
          .filter(
            (doc) =>
              doc.type === "invoice" &&
              doc.snapshot.draft.customer.trim().toLowerCase() ===
                enquiry.customerName.trim().toLowerCase() &&
              (!enquiry.email ||
                doc.snapshot.draft.email.trim().toLowerCase() ===
                  enquiry.email.trim().toLowerCase()),
          )
          .map((doc) => ({
            id: `${row.id}:${doc.id}`,
            title: doc.title,
            number: doc.number,
            saleId: String(row.id),
            issuedAt: doc.issuedAt,
            document: doc,
            archive: (
              row.archives as Record<
                string,
                { content: string; sha256: string }
              > | null
            )?.[doc.id],
          })),
      )
      .sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt))
      .slice(0, 30);
  }
  async function preview(
    id: string,
    input: Draft,
    config: PrivateDealerSettings,
    profile: Awaited<ReturnType<typeof dealerProfile>>,
    executor: typeof db = db,
  ) {
    const enquiry = await entry(id, executor);
    if (enquiry.workspaceRevision !== input.expectedRevision)
      throw new EmailError(
        "This enquiry changed. Close and reopen the email before sending.",
        409,
      );
    const facts: EmailFacts = [];
    const [car] = enquiry.vehicleId
      ? await executor
          .select()
          .from(vehiclesTable)
          .where(
            and(
              eq(vehiclesTable.id, enquiry.vehicleId),
              eq(vehiclesTable.dealerId, enquiry.dealerId),
            ),
          )
      : [];
    if (input.includeVehicle) {
      if (!car && !enquiry.vehicleTitle)
        throw new EmailError(
          "There is no vehicle information on this enquiry.",
        );
      facts.push({
        label: "Vehicle",
        value: car?.websiteTitleOverride || car?.title || enquiry.vehicleTitle!,
      });
      const registration = car
        ? vehicleRegistrationLabel(car)
        : enquiry.vehicleRegistration;
      if (registration)
        facts.push({ label: "Registration", value: registration });
      const price = car
        ? (car.websitePriceOverride ?? car.sourcePrice)
        : enquiry.vehiclePrice;
      if (price != null)
        facts.push({
          label: "Cash price",
          value: new Intl.NumberFormat("en-GB", {
            style: "currency",
            currency: "GBP",
            maximumFractionDigits: 0,
          }).format(price),
        });
      if (car) {
        for (const [label, value] of [
          ["Year", car.year],
          [
            "Mileage",
            car.mileage == null
              ? null
              : `${car.mileage.toLocaleString("en-GB")} miles`,
          ],
          ["Fuel", car.fuel],
          ["Gearbox", car.transmission],
          ["Colour", car.colour],
        ] as const)
          if (value != null && value !== "") facts.push({ label, value });
        facts.push({
          label: "Showroom status",
          value:
            car.inventoryStatus === "available" &&
            car.sourceStatus === "missing"
              ? "Source advert missing — ask the showroom to confirm availability"
              : car.inventoryStatus[0]!.toUpperCase() +
                car.inventoryStatus.slice(1),
        });
        if (
          car.sourceStatus === "live" &&
          ["available", "reserved"].includes(car.inventoryStatus)
        )
          facts.push({
            label: "Vehicle page",
            value: `${siteOrigin()}/vehicle/${car.id}`,
          });
      } else
        facts.push({
          label: "Vehicle record",
          value:
            "Ad hoc vehicle — availability must be confirmed with the showroom",
        });
    }
    if (input.includeAppointment) {
      if (!enquiry.appointmentAt)
        throw new EmailError("There is no appointment on this enquiry.");
      facts.push({
        label: "Test drive",
        value: new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          dateStyle: "full",
          timeStyle: "short",
        }).format(enquiry.appointmentAt),
      });
      facts.push({
        label: "Appointment status",
        value: enquiry.appointmentCancelledAt
          ? "Cancelled"
          : enquiry.appointmentStatus === "confirmed"
            ? "Confirmed"
            : "Awaiting showroom approval",
      });
      if (enquiry.appointmentOutsideHours)
        facts.push({
          label: "Appointment note",
          value: "Outside normal showroom hours",
        });
      if (profile.contact.address)
        facts.push({ label: "Showroom", value: profile.contact.address });
      if (profile.instructions)
        facts.push({ label: "Visit information", value: profile.instructions });
      if (profile.parkingInstructions)
        facts.push({ label: "Parking", value: profile.parkingInstructions });
    }
    const attachments: Array<{
      id: string;
      filename: string;
      content: string;
    }> = [];
    if (input.photoIds.length) {
      if (!car)
        throw new EmailError("Vehicle photos need a linked stock vehicle.");
      const rows = (
        await executor.execute(
          sql`SELECT id, category, encode(jpeg,'hex') AS bytes FROM vehicle_service_photos WHERE dealer_id=${enquiry.dealerId} AND vehicle_id=${car.id}::uuid AND id IN (${sql.join(
            input.photoIds.map((id) => sql`${id}::uuid`),
            sql`,`,
          )})`,
        )
      ).rows;
      if (rows.length !== input.photoIds.length)
        throw new EmailError(
          "A selected vehicle photo was removed or belongs to another car. Review the attachments.",
          409,
        );
      for (const [index, id] of input.photoIds.entries()) {
        const row = rows.find((r) => r.id === id)!;
        attachments.push({
          id,
          filename: `${enquiry.reference.replace(/[^A-Za-z0-9_-]/g, "") || "enquiry"}-${row.category === "pre_accident" ? "pre-accident" : "service-book"}-${index + 1}.jpg`,
          content: Buffer.from(String(row.bytes), "hex").toString("base64"),
        });
      }
    }
    if (input.documentIds.length) {
      const allowed = await invoiceAttachments(enquiry, executor, true);
      for (const id of input.documentIds) {
        const item = allowed.find((d) => d.id === id);
        if (!item)
          throw new EmailError(
            "An invoice is not available for this customer and car. Review its sale record.",
            409,
          );
        const archive = item.archive ?? archiveSaleDocument(item.document);
        attachments.push({
          id,
          filename: `${item.number.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`,
          content: archive.content,
        });
      }
    }
    if (
      attachments.reduce(
        (bytes, a) => bytes + Buffer.byteLength(a.content, "base64"),
        0,
      ) > 15_000_000
    )
      throw new EmailError(
        "The selected attachments are too large. Send fewer documents.",
      );
    facts.push({ label: "Enquiry reference", value: enquiry.reference });
    // Submitted copy is literal text; braces/HTML entered by staff never become templates or markup.
    const rendered = renderEmailTemplate(
      { subject: "{{document_type}}", body: "{{message}}" },
      {
        document_type: input.subject,
        message: input.message,
        dealer_name: profile.identity.name,
        customer_name: enquiry.customerName,
        customer_email: input.to,
        dealer_email: profile.contact.email,
        dealer_phone: profile.contact.phone,
        dealer_address: profile.contact.address,
        reference: enquiry.reference,
        vehicle_title:
          car?.websiteTitleOverride || car?.title || enquiry.vehicleTitle || "",
        vehicle_registration: car
          ? vehicleRegistrationLabel(car)
          : enquiry.vehicleRegistration || "",
      },
      facts,
      config.appearance,
    );
    const previewHash = hash(
      JSON.stringify({
        to: input.to,
        ...rendered,
        attachments: attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          digest: hash(a.content),
        })),
      }),
    );
    return { enquiry, rendered, attachments, previewHash };
  }
  function failure(req: any, res: any, error: unknown) {
    if (error instanceof EmailError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log?.warn("Enquiry email request failed");
    res.status(503).json({
      error:
        "Email is unavailable. Check the delivery history before trying again.",
    });
  }
  router.get("/staff/enquiries/:id/email-context", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    try {
      const enquiry = await entry(String(req.params.id)),
        config = await deps.settings(),
        profile = await dealerProfile();
      const template = {
        ...defaultEmailTemplates.find((t) => t.id === "enquiry_message")!,
        ...config.templates.enquiry_message,
      };
      const defaults = renderEmailTemplate(
        template,
        {
          customer_name: enquiry.customerName,
          customer_email: enquiry.email,
          vehicle_title: enquiry.vehicleTitle || "Your enquiry",
          dealer_name: profile.identity.name,
          dealer_phone: profile.contact.phone,
          dealer_email: profile.contact.email,
          reference: enquiry.reference,
          message:
            "Here are the details we discussed. Please let us know if you have any questions.",
        },
        [],
        { ...config.appearance, heading: "", footer: "" },
      );
      const photos = enquiry.vehicleId
        ? (
            await db.execute(
              sql`SELECT id, category, byte_size, created_at FROM vehicle_service_photos WHERE dealer_id=${enquiry.dealerId} AND vehicle_id=${enquiry.vehicleId}::uuid ORDER BY category,created_at,id LIMIT 6`,
            )
          ).rows
        : [];
      const deliveries = await db
        .select()
        .from(enquiryEmailsTable)
        .where(
          and(
            eq(enquiryEmailsTable.dealerId, enquiry.dealerId),
            eq(enquiryEmailsTable.enquiryId, enquiry.id),
          ),
        )
        .orderBy(desc(enquiryEmailsTable.createdAt))
        .limit(5);
      const resend = effectiveResendSettings(config),
        ready =
          resend.enabled &&
          integrationReadiness({ ...config, resend }).resend.ready;
      const variables = {
        customer_name: enquiry.customerName,
        customer_email: enquiry.email,
        vehicle_title: enquiry.vehicleTitle || "Your enquiry",
        vehicle_registration: enquiry.vehicleRegistration || "",
        dealer_name: profile.identity.name,
        dealer_phone: profile.contact.phone,
        dealer_email: profile.contact.email,
        reference: enquiry.reference,
        message:
          "Here are the details we discussed. Please let us know if you have any questions.",
      };
      const templates = defaultEmailTemplates
        .filter((t) =>
          [
            "enquiry_message",
            "invoice_copy",
            "vehicle_details",
            "service_history",
            "pre_accident_photos",
            "appointment_details",
          ].includes(t.id),
        )
        .map((t) => {
          const rendered = renderEmailTemplate(
            { ...t, ...config.templates[t.id] },
            variables,
            [],
            { ...config.appearance, heading: "", footer: "" },
          );
          return {
            id: t.id,
            label: t.label,
            subject: rendered.subject,
            message: rendered.text,
          };
        });
      const invoices = (await invoiceAttachments(enquiry)).map(
        ({ id, title, number, saleId, issuedAt }) => ({
          id,
          title,
          number,
          saleId,
          issuedAt,
        }),
      );
      res.json({
        templates,
        invoices,
        email: enquiry.email || "",
        customerName: enquiry.customerName,
        vehicleId: enquiry.vehicleId,
        vehicleTitle: enquiry.vehicleTitle,
        reference: enquiry.reference,
        revision: enquiry.workspaceRevision,
        vehicleAvailable: Boolean(enquiry.vehicleTitle || enquiry.vehicleId),
        appointmentAvailable: Boolean(enquiry.appointmentAt),
        defaults: { subject: defaults.subject, message: defaults.text },
        ready,
        photos,
        deliveries: deliveries.map(describe),
      });
    } catch (error) {
      failure(req, res, error);
    }
  });
  router.post("/staff/enquiries/:id/email-preview", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Check the email address, subject, message and attachments.",
      });
      return;
    }
    try {
      const result = await preview(
        String(req.params.id),
        parsed.data,
        await deps.settings(),
        await dealerProfile(),
      );
      res.json({
        to: parsed.data.to,
        subject: result.rendered.subject,
        text: result.rendered.text,
        previewHash: result.previewHash,
        attachments: result.attachments.map(({ id, filename, content }) => ({
          id,
          filename,
          byteSize: Buffer.byteLength(content, "base64"),
        })),
      });
    } catch (error) {
      failure(req, res, error);
    }
  });
  router.post("/staff/enquiries/:id/email", async (req, res) => {
    res.setHeader("Cache-Control", "no-store, private");
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Review the email before sending." });
      return;
    }
    try {
      const input = parsed.data,
        dealer = currentDealerId(),
        id = String(req.params.id),
        requestHash = hash(
          JSON.stringify({
            ...input,
            documentIds: input.documentIds.length
              ? input.documentIds
              : undefined,
          }),
        );
      if (!uuid(id)) throw new EmailError("Enquiry not found.", 404);
      const config = await deps.settings(),
        resend = effectiveResendSettings(config),
        profile = await dealerProfile();
      const claimed = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${key(dealer, id)}))`,
        );
        const [existing] = await tx
          .select()
          .from(enquiryEmailsTable)
          .where(
            and(
              eq(enquiryEmailsTable.dealerId, dealer),
              eq(enquiryEmailsTable.enquiryId, id),
              eq(enquiryEmailsTable.requestId, input.requestId),
            ),
          );
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new EmailError(
              "This email request was already used for different content.",
              409,
            );
          return { existing };
        }
        if (
          !resend.enabled ||
          !integrationReadiness({ ...config, resend }).resend.ready
        )
          throw new EmailError(
            "Email delivery is not ready. Ask the owner to enable Resend in Settings → API integrations.",
            503,
          );
        await tx
          .select({ id: enquiriesTable.id })
          .from(enquiriesTable)
          .where(
            and(eq(enquiriesTable.id, id), eq(enquiriesTable.dealerId, dealer)),
          )
          .for("update");
        const result = await preview(
          id,
          input,
          config,
          profile,
          tx as unknown as typeof db,
        );
        if (result.previewHash !== input.previewHash)
          throw new EmailError(
            "The details or attachments changed after your preview. Review the email again.",
            409,
          );
        const recent = (
          await tx.execute(
            sql`SELECT count(*) AS n FROM enquiry_emails WHERE dealer_id=${dealer} AND enquiry_id=${id}::uuid AND created_at>now()-interval '1 hour'`,
          )
        ).rows[0];
        if (Number(recent?.n ?? 0) >= 20)
          throw new EmailError(
            "This enquiry has reached its email limit. Wait before sending another message.",
            429,
          );
        const [delivery] = await tx
          .insert(enquiryEmailsTable)
          .values({
            id: randomUUID(),
            dealerId: dealer,
            enquiryId: id,
            requestId: input.requestId,
            requestHash,
            status: "sending",
            recipient: input.to,
            subject: input.subject,
            message: input.message,
            renderedText: result.rendered.text,
            attachmentManifest: result.attachments.map((a) => ({
              id: a.id,
              filename: a.filename,
              byteSize: Buffer.byteLength(a.content, "base64"),
            })),
            photoIds: input.photoIds,
            documentIds: input.documentIds,
            createdBy: req.staff!.authUserId,
          })
          .returning();
        return { delivery: delivery!, result };
      });
      if ("existing" in claimed) {
        res.json({ delivery: describe(claimed.existing!), replayed: true });
        return;
      }
      const { delivery, result } = claimed;
      let status: "sent" | "failed" | "unknown" = "sent",
        providerId: string | null = null,
        error: string | null = null;
      try {
        providerId = await deps.send(resend, {
          to: input.to,
          ...result!.rendered,
          idempotencyKey: `enquiry-${delivery!.id}`,
          attachments: result!.attachments.map(({ filename, content }) => ({
            filename,
            content,
          })),
        });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : "";
        status = /HTTP 4\d\d\./.test(reason) ? "failed" : "unknown";
        error =
          status === "failed"
            ? "The email provider rejected this message. Check the sender and recipient before preparing another email."
            : "Provider acceptance could not be confirmed. Check Resend before sending another copy.";
      }
      const finished = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(enquiryEmailsTable)
          .set({ status, providerId, error, finishedAt: new Date() })
          .where(
            and(
              eq(enquiryEmailsTable.id, delivery!.id),
              eq(enquiryEmailsTable.dealerId, dealer),
            ),
          )
          .returning();
        await tx.insert(enquiryEventsTable).values({
          dealerId: dealer,
          enquiryId: id,
          vehicleId: result!.enquiry.vehicleId,
          vehicleTitle: result!.enquiry.vehicleTitle,
          kind: "conversation_logged",
          actor: "dealer",
          summary:
            status === "sent"
              ? "Email submitted to Resend"
              : status === "unknown"
                ? "Email acceptance unconfirmed"
                : "Email not sent",
          detail: {
            channel: "email",
            staffId: req.staff!.authUserId,
            staffName: staffLabel(req),
            note: `To: ${input.to}\nSubject: ${input.subject}\n${input.message}\n${input.photoIds.length} vehicle photo${input.photoIds.length === 1 ? "" : "s"} and ${input.documentIds.length} invoice(s) attached.${error ? "\n" + error : ""}`,
          },
        });
        return row!;
      });
      res.status(201).json({ delivery: describe(finished), replayed: false });
    } catch (error) {
      failure(req, res, error);
    }
  });
  return router;
}
export default createEnquiryEmailRouter();
