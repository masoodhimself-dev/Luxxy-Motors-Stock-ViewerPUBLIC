import { readEmailDraft } from "../lib/email-drafts";
import { checkSavedAiDraftFresh, AiDraftError } from "../lib/ai-drafts";
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
  approvedEmailLayoutVersion,
  type EmailLayoutVersion,
  vehicleRegistrationLabel,
  type EmailFacts,
  type SaleWorkspaceDocument,
} from "@workspace/vehicle-meta";
import {
  requireStaff,
  requirePermission,
  staffLabel,
} from "../middlewares/staff-auth";
import {
  currentDealerId,
  currentTenant,
  multiTenantEnabled,
} from "../lib/tenant-context";
import {
  dealerIntegrationsStore,
  effectiveResendSettings,
  integrationReadiness,
  type PrivateDealerSettings,
} from "../lib/dealer-integrations-store";
import {
  sendEmailWithSettings,
  sendPreparedEmail,
  type EmailEnvelope,
  type EmailRequest,
} from "../lib/email-provider";
import {
  enqueueEmailOutbox,
  attemptQueuedEmail,
  recoverEmailOutbox,
  staffOutboxMetadata,
  type EmailOutbox,
} from "../lib/email-outbox";
import {
  withEmailPreparation,
  EmailPreparationBusy,
} from "../lib/email-preparation";
import { dealerProfile } from "../lib/enquiry-notifications";
import { siteOrigin } from "../lib/enquiry-links";
import { enquiryMediaContext, selectedEnquiryMedia, EnquiryMediaError, mediaRequestIdentity } from "../lib/enquiry-media";

export const draftSchema = z
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
    templateId: z
      .enum([
        "enquiry_message",
        "invoice_copy",
        "vehicle_details",
        "service_history",
        "pre_accident_photos",
        "appointment_details",
      ])
      .optional(),
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
    customPhotoIds: z.array(z.string().uuid()).max(2).refine(v => new Set(v).size === v.length).default([]),
    vehiclePhotoIndices: z.array(z.number().int().min(0).max(99)).max(4).refine(v => new Set(v).size === v.length).default([]),
    includeVideo: z.boolean().default(false),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
const sendSchema = draftSchema.extend({
  savedDraftVersion: z.number().int().positive().optional(),
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
const describe = (
  row: typeof enquiryEmailsTable.$inferSelect,
  metadata?: { retryAt: string | null; attempts: number },
) => ({
  id: row.id,
  requestId: row.requestId,
  to: row.recipient,
  subject: row.subject,
  status: row.status,
  photoCount: row.photoIds.length + row.attachmentManifest.filter(a => a.filename.startsWith("enquiry-photo-")).length,
  documentCount: row.documentIds.length,
  createdAt: row.createdAt,
  finishedAt: row.finishedAt,
  error: row.error,
  ...(metadata ?? {}),
});
const dependencies = {
  settings: () => dealerIntegrationsStore.readPrivate(),
  send: sendEmailWithSettings,
};

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
  if (row.mergedIntoId)
    throw new EmailError(
      "This enquiry was merged. Open the current enquiry before preparing a reply.",
      409,
    );
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
  rawInput: Omit<Draft, "customPhotoIds" | "vehiclePhotoIndices" | "includeVideo"> & Partial<Pick<Draft, "customPhotoIds" | "vehiclePhotoIndices" | "includeVideo">>,
  config: PrivateDealerSettings,
  profile: Awaited<ReturnType<typeof dealerProfile>>,
  executor: typeof db = db,
  layoutVersion: EmailLayoutVersion = "correspondence-v1",
) {
  const input = {...rawInput, customPhotoIds: rawInput.customPhotoIds ?? [], vehiclePhotoIndices: rawInput.vehiclePhotoIndices ?? [], includeVideo: rawInput.includeVideo ?? false};
  return withEmailPreparation(async () => {
    const enquiry = await entry(id, executor);
    await checkSavedAiDraftFresh(
      executor,
      enquiry.dealerId,
      enquiry.id,
      await readEmailDraft(enquiry.dealerId, enquiry.id, executor),
    );
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
    const requiredPhotoCategory =
      input.templateId === "service_history"
        ? "service_book"
        : input.templateId === "pre_accident_photos"
          ? "pre_accident"
          : null;
    if (input.templateId === "invoice_copy" && input.documentIds.length === 0)
      throw new EmailError(
        "Attach an invoice for this customer before reviewing this invoice email.",
      );
    if (requiredPhotoCategory && input.photoIds.length === 0)
      throw new EmailError(
        `Attach at least one ${requiredPhotoCategory === "service_book" ? "service-book" : "pre-accident"} photo before reviewing this email.`,
      );
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
      if (
        requiredPhotoCategory &&
        !rows.some((row) => row.category === requiredPhotoCategory)
      )
        throw new EmailError(
          `This template needs a ${requiredPhotoCategory === "service_book" ? "service-book" : "pre-accident"} photo. Review the attachments.`,
        );
      for (const [index, id] of input.photoIds.entries()) {
        const row = rows.find((r) => r.id === id)!;
        attachments.push({
          id,
          filename: `vehicle-${row.category === "pre_accident" ? "pre-accident" : "service-book"}-${index + 1}.jpg`,
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
    const media = await selectedEnquiryMedia(enquiry, input, executor);
    attachments.push(...media.attachments);
    facts.push(...media.facts);
    if (
      attachments.reduce(
        (bytes, a) => bytes + Buffer.byteLength(a.content, "base64"),
        0,
      ) > 15_000_000
    )
      throw new EmailError(
        "The selected attachments are too large. Send fewer documents.",
      );
    // Submitted copy is literal text; braces/HTML entered by staff never become templates or markup.
    const rendered = renderEmailTemplate(
      {
        subject: "{{document_type}}",
        body: "{{message}}",
        headline:
          config.templates[input.templateId ?? "enquiry_message"]?.headline,
      },
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
      {
        templateId: input.templateId ?? "enquiry_message",
        layoutVersion,
        attachments: attachments.map((item) => item.filename),
      },
    );
    const previewHash = hash(
      JSON.stringify({
        to: input.to,
        ...rendered,
        ...(media.videoId ? {videoId: media.videoId} : {}),
        attachments: attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          digest: hash(a.content),
        })),
      }),
    );
    return { enquiry, rendered, attachments, previewHash };
  });
}

export async function rebuildStaffOutboxEmail(
  row: EmailOutbox,
  suppliedConfig?: PrivateDealerSettings,
): Promise<EmailRequest> {
  if (row.kind !== "staff" || row.dealer_id !== currentDealerId())
    throw new Error("The approved email context is invalid.");
  const actor = (
    await db.execute(
      sql`SELECT m.created_by,u.role,u.disabled_at FROM enquiry_emails m LEFT JOIN portal_users u ON u.dealer_id=m.dealer_id AND u.auth_user_id=m.created_by WHERE m.id=${row.delivery_id}::uuid AND m.dealer_id=${row.dealer_id} AND m.enquiry_id=${row.enquiry_id}::uuid`,
    )
  ).rows[0];
  const machine =
    !multiTenantEnabled() &&
    actor?.created_by === "machine" &&
    Boolean(process.env.PORTAL_API_TOKEN) &&
    row.validation.machineTokenHash === hash(process.env.PORTAL_API_TOKEN!);
  if (
    !machine &&
    (!actor ||
      actor.disabled_at ||
      !["owner", "salesperson"].includes(String(actor.role)))
  )
    throw new Error("The email approval is no longer authorised.");
  const input = draftSchema.parse(row.validation.input),
    config = suppliedConfig ?? (await dealerIntegrationsStore.readPrivate());
  const result = await preview(
    row.enquiry_id,
    input,
    config,
    await dealerProfile(),
    db,
    approvedEmailLayoutVersion(row.validation.layoutVersion),
  );
  if (result.previewHash !== row.validation.previewHash)
    throw new Error(
      "The approved customer, car or attachment details changed.",
    );
  return {
    to: input.to,
    ...result.rendered,
    idempotencyKey: row.send_key,
    attachments: result.attachments.map(({ filename, content }) => ({
      filename,
      content,
    })),
  };
}
export { preview as previewEnquiryEmail };

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
  function failure(req: any, res: any, error: unknown) {
    if (error instanceof EmailPreparationBusy) {
      res.set("Retry-After", "15").status(503).json({ error: error.message });
      return;
    }
    if (error instanceof EmailError || error instanceof AiDraftError || error instanceof EnquiryMediaError) {
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
      await recoverEmailOutbox();
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
          dealer_address: profile.contact.address,
          reference: enquiry.reference,
          appointment_time: enquiry.appointmentAt
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone: "Europe/London",
                dateStyle: "full",
                timeStyle: "short",
              }).format(enquiry.appointmentAt) + " (UK time)"
            : "",
          appointment_status: enquiry.appointmentAt
            ? enquiry.appointmentCancelledAt
              ? "Cancelled"
              : enquiry.appointmentStatus === "confirmed"
                ? "Confirmed"
                : "Awaiting showroom approval"
            : "",
          duration: enquiry.appointmentAt
            ? `${enquiry.appointmentDurationMinutes ?? 30} minutes`
            : "",
          visit_instructions: enquiry.appointmentAt ? profile.instructions : "",
          parking_instructions: enquiry.appointmentAt
            ? profile.parkingInstructions
            : "",
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
      const outboxMetadata = await staffOutboxMetadata(enquiry.id);
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
        dealer_address: profile.contact.address,
        reference: enquiry.reference,
        appointment_time: enquiry.appointmentAt
          ? new Intl.DateTimeFormat("en-GB", {
              timeZone: "Europe/London",
              dateStyle: "full",
              timeStyle: "short",
            }).format(enquiry.appointmentAt) + " (UK time)"
          : "",
        appointment_status: enquiry.appointmentAt
          ? enquiry.appointmentCancelledAt
            ? "Cancelled"
            : enquiry.appointmentStatus === "confirmed"
              ? "Confirmed"
              : "Awaiting showroom approval"
          : "",
        duration: enquiry.appointmentAt
          ? `${enquiry.appointmentDurationMinutes ?? 30} minutes`
          : "",
        visit_instructions: enquiry.appointmentAt ? profile.instructions : "",
        parking_instructions: enquiry.appointmentAt
          ? profile.parkingInstructions
          : "",
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
            message: rendered.bodyText,
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
        ...(await readEmailDraft(enquiry.dealerId, enquiry.id)),
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
        defaults: { subject: defaults.subject, message: defaults.bodyText },
        ready,
        photos,
        ...(await enquiryMediaContext(enquiry)),
        deliveries: deliveries.map((row) =>
          describe(row, outboxMetadata.get(row.id)),
        ),
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
        html: result.rendered.html,
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
      await withEmailPreparation(async () => {
        const input = parsed.data,
          dealer = currentDealerId(),
          id = String(req.params.id),
          requestHash = hash(
            JSON.stringify({
              ...mediaRequestIdentity(input),
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
              and(
                eq(enquiriesTable.id, id),
                eq(enquiriesTable.dealerId, dealer),
              ),
            )
            .for("update");
          const result = await preview(
            id,
            input,
            config,
            profile,
            tx as unknown as typeof db,
          );
          if (input.savedDraftVersion !== undefined) {
            const saved = await readEmailDraft(
              dealer,
              id,
              tx as unknown as typeof db,
            );
            const {
              savedDraftVersion: _version,
              requestId: _request,
              previewHash: _preview,
              ...copy
            } = input;
            const savedContent = draftSchema.safeParse(
              saved.savedDraft?.content,
            );
            if (
              saved.version !== input.savedDraftVersion ||
              saved.savedDraft?.status !== "draft" ||
              !savedContent.success ||
              JSON.stringify(savedContent.data) !== JSON.stringify(copy)
            )
              throw new EmailError(
                "The saved draft changed. Reopen it and review before sending.",
                409,
              );
          }
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
              subject: result.rendered.subject,
              message: result.rendered.bodyText,
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
          const {
            requestId: _requestId,
            previewHash: _previewHash,
            savedDraftVersion: _savedVersion,
            ...approvedInput
          } = input;
          const outbox = await enqueueEmailOutbox(
            {
              enquiryId: id,
              deliveryId: delivery!.id,
              kind: "staff",
              config: resend,
              request: {
                to: input.to,
                ...result.rendered,
                idempotencyKey: `enquiry-${delivery!.id}`,
                attachments: result.attachments.map(
                  ({ filename, content }) => ({ filename, content }),
                ),
              },
              validation: {
                input: approvedInput,
                layoutVersion: "correspondence-v1",
                previewHash: input.previewHash,
                ...(!multiTenantEnabled() && req.staff!.authUserId === "machine"
                  ? {
                      machineTokenHash: hash(
                        process.env.PORTAL_API_TOKEN ?? "",
                      ),
                    }
                  : {}),
              },
            },
            tx,
          );
          if (input.savedDraftVersion !== undefined)
            await tx.execute(
              sql`UPDATE enquiry_email_drafts SET status='sending',send_request_id=${input.requestId}::uuid,updated_at=now() WHERE dealer_id=${dealer} AND enquiry_id=${id}::uuid AND version=${input.savedDraftVersion}`,
            );
          return { delivery: delivery!, result, outboxId: outbox.id };
        });
        if ("existing" in claimed) {
          res.json({
            delivery: describe(
              claimed.existing!,
              (await staffOutboxMetadata(id)).get(claimed.existing!.id),
            ),
            replayed: true,
          });
          return;
        }
        const { delivery, result, outboxId } = claimed;
        await attemptQueuedEmail(outboxId!, {
          settings: async () => effectiveResendSettings(await deps.settings()),
          rebuild: async (row) =>
            rebuildStaffOutboxEmail(row, await deps.settings()),
          ...(deps.send === sendEmailWithSettings
            ? {}
            : {
                send: async (settings, body, sendKey) => {
                  const envelope = JSON.parse(body) as EmailEnvelope;
                  return deps.send(
                    {
                      ...settings,
                      from: envelope.from,
                      replyTo: envelope.reply_to ?? "",
                    },
                    {
                      to: envelope.to[0]!,
                      subject: envelope.subject,
                      html: envelope.html,
                      text: envelope.text,
                      attachments: envelope.attachments,
                      idempotencyKey: sendKey,
                    },
                  );
                },
              }),
        });
        const [finished] = await db
          .select()
          .from(enquiryEmailsTable)
          .where(
            and(
              eq(enquiryEmailsTable.id, delivery!.id),
              eq(enquiryEmailsTable.dealerId, dealer),
            ),
          );
        if (!finished)
          throw new EmailError("The saved email is unavailable.", 503);
        await db.insert(enquiryEventsTable).values({
          dealerId: dealer,
          enquiryId: id,
          vehicleId: result!.enquiry.vehicleId,
          vehicleTitle: result!.enquiry.vehicleTitle,
          kind: "conversation_logged",
          actor: "dealer",
          summary:
            finished.status === "sent"
              ? "Email submitted to Resend"
              : finished.status === "sending"
                ? "Approved email queued for delivery"
                : finished.status === "unknown"
                  ? "Email acceptance unconfirmed"
                  : "Email not sent",
          detail: {
            channel: "email",
            staffId: req.staff!.authUserId,
            staffName: staffLabel(req),
            note: `To: ${input.to}\nSubject: ${result!.rendered.subject}\n${result!.rendered.bodyText}\n${input.photoIds.length + input.customPhotoIds.length} photo(s) and ${input.documentIds.length} invoice(s) attached.${input.vehiclePhotoIndices.length ? `\n${input.vehiclePhotoIndices.length} car photo link(s) included.` : ""}${input.includeVideo ? "\nPublished car video link included." : ""}${finished.error ? "\n" + finished.error : ""}`,
          },
        });
        res.status(201).json({
          delivery: describe(
            finished,
            (await staffOutboxMetadata(id)).get(finished.id),
          ),
          replayed: false,
        });
      });
    } catch (error) {
      failure(req, res, error);
    }
  });
  return router;
}
export default createEnquiryEmailRouter();
