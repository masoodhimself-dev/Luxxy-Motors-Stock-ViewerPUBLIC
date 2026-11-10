import { publicVehicleDetailPath } from '../lib/public-vehicle-links';
import { reviewReminderEmail } from '@workspace/vehicle-meta';
import { readEmailDraft } from "../lib/email-drafts";
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
  dealerSettingsTable,
  vehiclesTable,
} from "@workspace/db";
import {
  defaultEmailTemplates,
  renderEmailTemplate,
  approvedEmailLayoutVersion,
  type EmailLayoutVersion,
  isUKNumberPlate,
  vehicleRegistration,
  vehicleRegistrationLabel,
  saleDocumentEmailRecipientProblem,
  type EmailFacts,
  type SaleWorkspaceDocument,
  type SaleWorkspaceDraft,
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
  EmailProviderError,
  prepareEmailWithSettings,
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
import { cazooFirstReplyActor, decideCazooAutomaticFirstReply } from "../lib/cazoo-automatic-first-reply";
import { acceptedEnquiryReply, replyConfiguration } from "../lib/customer-email-replies";
import { cazooAutomaticReplyOptedIn } from "../lib/enquiry-ai-automation";
import { siteOrigin } from "../lib/enquiry-links";
import { enquiryGalleryContext, selectedEnquiryGallery, EnquiryGalleryError } from "../lib/enquiry-gallery";
import { createEnquiryVehiclePdf, EnquiryVehiclePdfError } from "../lib/enquiry-vehicle-pdf";
import { brochureDealer } from "../lib/vehicle-brochure";
import { findVisibleStockVehicle } from "./stock";


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
    attachVehiclePdf: z.boolean().default(false),
    photoIds: z
      .array(z.string().uuid())
      .max(6)
      .refine((v) => new Set(v).size === v.length),
    documentIds: z
      .array(z.string().regex(/^[a-f0-9-]{36}:[a-f0-9-]{36}$/i))
      .max(3)
      .refine((v) => new Set(v).size === v.length)
      .default([]),
    vehiclePhotoIndices: z.array(z.number().int().min(0).max(99)).max(4).refine(v => new Set(v).size === v.length).default([]),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
const reviewSchema = draftSchema.extend({
  enquiryReplyId: z.string().uuid().transform((id) => id.toLowerCase()).optional(),
});
const sendSchema = reviewSchema.extend({
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
async function requireReplyRecipient(enquiryId: string, replyId: string | undefined, to: string, executor?: Pick<typeof db, "execute">) {
  if (replyId && (await acceptedEnquiryReply(enquiryId, replyId, executor))?.from !== to)
    throw new EmailError("The linked customer reply is unavailable for this address. Check the reply in the Inbox.", 409);
}
const cazooFirstReplyKey = (receiptId: string) => `cazoo-first-reply-${receiptId}`;
type CazooFirstReplyReceipt = {
  id: string;
  enquiry_id: string;
  dealer_id: string;
  mailbox: string;
  error_code?: string | null;
  received_at?: Date | string;
};
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
  documentCount: row.documentIds.length + row.attachmentManifest.filter(a => a.id.startsWith("vehicle-pdf:")).length,
  createdAt: row.createdAt,
  finishedAt: row.finishedAt,
  error: row.error,
  ...(metadata ?? {}),
});
const dependencies = {
  settings: () => dealerIntegrationsStore.readPrivate(),
  send: sendEmailWithSettings,
};

async function enquiryVehiclePdf(enquiry: { dealerId: string; vehicleId: string | null }, executor: typeof db) {
  if (!enquiry.vehicleId || enquiry.dealerId !== currentDealerId()) throw new EnquiryVehiclePdfError("A vehicle PDF needs a linked stock car from this dealership.");
  return createEnquiryVehiclePdf({
    findVehicle: id => findVisibleStockVehicle(id, executor),
    readDealer: async () => {
      const [settings] = await executor.select({ config: dealerSettingsTable.config }).from(dealerSettingsTable).where(eq(dealerSettingsTable.dealerId, enquiry.dealerId));
      return brochureDealer(settings?.config);
    },
  })(enquiry.vehicleId, siteOrigin());
}

async function entry(id: string, executor: typeof db = db, allowArchived = false) {
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
  if (row.archivedAt && !allowArchived) throw new EmailError('Restore this enquiry before preparing or sending a message.', 409);
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
      sql`SELECT id,state->'draft' AS current_buyer,state->'documents' AS documents,CASE WHEN ${content} THEN state->'documentArchives' ELSE NULL END AS archives FROM sale_workspace WHERE dealer_id=${enquiry.dealerId} AND state#>>'{draft,vehicleId}'=${enquiry.vehicleId} AND (state#>>'{draft,sourceEnquiryId}'=${enquiry.id} OR (${enquiry.email ?? ""}<>'' AND lower(state#>>'{draft,email}')=lower(${enquiry.email ?? ""}))) ORDER BY updated_at DESC LIMIT 20`,
    )
  ).rows;
  return rows
    .flatMap((row) =>
      ((row.documents ?? []) as SaleWorkspaceDocument[])
        .filter(
          (doc) =>
            doc.type === "invoice" &&
            Boolean(row.current_buyer) &&
            !saleDocumentEmailRecipientProblem(row.current_buyer as Pick<SaleWorkspaceDraft, 'customer' | 'email'>, doc.snapshot.draft) &&
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
  rawInput: Omit<Draft, "vehiclePhotoIndices" | "attachVehiclePdf"> & Partial<Pick<Draft, "vehiclePhotoIndices" | "attachVehiclePdf">>,
  config: PrivateDealerSettings,
  profile: Awaited<ReturnType<typeof dealerProfile>>,
  executor: typeof db = db,
  layoutVersion: EmailLayoutVersion = "correspondence-v1",
) {
  const input = {...rawInput, vehiclePhotoIndices: rawInput.vehiclePhotoIndices ?? []};
  return withEmailPreparation(async () => {
    const enquiry = await entry(id, executor);
    const saved = await readEmailDraft(enquiry.dealerId, enquiry.id, executor);
    if (saved.savedDraft?.content && typeof saved.savedDraft.content === 'object' && 'stockChange' in saved.savedDraft.content) throw new EmailError('This retired stock-update draft must be discarded before composing a fresh email.',409);
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
            value: `${siteOrigin()}${await publicVehicleDetailPath(car, executor)}`,
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
    if (input.attachVehiclePdf) attachments.push(await enquiryVehiclePdf(enquiry, executor));
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
        if (item.document.snapshot.draft.email.trim().toLowerCase() !== input.to.trim().toLowerCase()) {
          throw new EmailError("The saved invoice has a different recipient. Check the email address or remove the invoice attachment.", 409);
        }
        const archive = item.archive ?? archiveSaleDocument(item.document);
        attachments.push({
          id,
          filename: `${item.number.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`,
          content: archive.content,
        });
      }
    }
    facts.push(...await selectedEnquiryGallery(enquiry, input, executor));
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
        attachments: attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          digest: hash(a.content),
        })),
      }),
    );
    return { enquiry, rendered, attachments, previewHash, whatsappVariables: {
      customer_name: enquiry.customerName,
      dealer_name: profile.identity.name,
      vehicle_title: car?.websiteTitleOverride || car?.title || enquiry.vehicleTitle || '',
      vehicle_registration: car ? vehicleRegistrationLabel(car) : enquiry.vehicleRegistration || '',
      appointment_time: enquiry.appointmentAt ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' }).format(enquiry.appointmentAt) + (layoutVersion === 'legacy-v1' ? ' (UK time)' : '') : '',
      message: rendered.bodyText,
    } };
  });
}

async function cazooFirstReplyCandidate(
  receipt: CazooFirstReplyReceipt,
  enquiry: typeof enquiriesTable.$inferSelect,
  dealerName: string,
  executor: Pick<typeof db, "execute">,
  ownDeliveryId?: string,
) {
  const { dealer_id: dealer, enquiry_id: id } = receipt;
  if (
    enquiry.source !== "cazoo" || enquiry.type !== "general" ||
    enquiry.status !== "new" || enquiry.archivedAt || enquiry.mergedIntoId ||
    enquiry.preferredContact !== "email" || !enquiry.email || !enquiry.vehicleId ||
    enquiry.customerNotificationStatus !== "not_sent" ||
    enquiry.workspaceRevision !== (ownDeliveryId ? 1 : 0) ||
    !isUKNumberPlate(enquiry.vehicleRegistration)
  ) return null;
  const evidence = (await executor.execute(sql`
    SELECT r.received_at
    FROM cazoo_lead_receipts r
    WHERE r.id=${receipt.id}::uuid AND r.dealer_id=${dealer} AND r.enquiry_id=${id}::uuid
      AND r.mailbox=${receipt.mailbox} AND r.status='imported' AND r.error_code IS NULL
      AND r.correlation_id IS NOT NULL
      AND r.received_at BETWEEN now()-interval '15 minutes' AND now()
      AND NOT EXISTS(SELECT 1 FROM enquiry_events e WHERE e.dealer_id=${dealer} AND e.enquiry_id=${id}::uuid AND e.actor='dealer')
      AND NOT EXISTS(SELECT 1 FROM enquiry_email_drafts d WHERE d.dealer_id=${dealer} AND d.enquiry_id=${id}::uuid)
      AND NOT EXISTS(SELECT 1 FROM enquiry_email_replies p WHERE p.dealer_id=${dealer} AND p.enquiry_id=${id}::uuid)
      AND NOT EXISTS(SELECT 1 FROM enquiry_emails m WHERE m.dealer_id=${dealer} AND m.enquiry_id=${id}::uuid AND m.id IS DISTINCT FROM ${ownDeliveryId ?? null}::uuid)
      AND NOT EXISTS(SELECT 1 FROM email_outbox q WHERE q.dealer_id=${dealer} AND q.enquiry_id=${id}::uuid AND q.kind IN ('customer','reminder'))
  `)).rows[0];
  if (!evidence || !cazooAutomaticReplyOptedIn(dealer, process.env, new Date(evidence.received_at as string | Date))) return null;
  const registration = enquiry.vehicleRegistration!.toUpperCase().replace(/[\s-]/g, "");
  const cars = (await executor.execute(sql`
    WITH latest_stock AS (
      SELECT r.id,r.run_id,r.retailer_id,r.scraped_at,r.complete,r.expected_count,r.received_count,r.errors,
        a.dealer_id AS official_dealer,a.enabled AS official_enabled,a.retailer_id AS official_retailer,a.feed_id
      FROM stock_import_runs r JOIN dealerships d ON d.id=r.dealer_id AND d.retailer_id=r.retailer_id
      LEFT JOIN cazoo_feed_authority a ON a.dealer_id=d.id
      WHERE r.dealer_id=${dealer} AND d.stock_platform='cazoo' AND d.status='active'
        AND r.source='cazoo' AND r.status='completed'
      ORDER BY r.scraped_at DESC,r.received_at DESC,r.id DESC LIMIT 1
    ), latest_official_check AS (
      SELECT c.* FROM cazoo_feed_checks c WHERE c.dealer_id=${dealer}
      ORDER BY c.received_at DESC,c.id DESC LIMIT 1
    )
    SELECT v.id,v.title,v.website_title_override,v.make,v.model,v.registration,v.vrm,v.plate,v.inventory_status,
      EXISTS(SELECT 1 FROM latest_stock s WHERE s.id=v.import_run_id AND s.complete=true
        AND s.expected_count=s.received_count AND s.errors='[]'::jsonb
        AND CASE WHEN s.official_dealer IS NULL THEN
          s.run_id NOT LIKE 'cazoo-csv:%' AND s.scraped_at BETWEEN now()-interval '36 hours' AND now()
        ELSE s.official_enabled AND s.official_retailer=s.retailer_id AND s.run_id LIKE 'cazoo-csv:%'
          AND EXISTS(SELECT 1 FROM latest_official_check c
            LEFT JOIN cazoo_feed_checks origin ON origin.id=c.based_on_check_id AND origin.dealer_id=c.dealer_id
            WHERE c.received_at BETWEEN now()-interval '36 hours' AND now()
              AND c.completed_at IS NOT NULL AND c.error_code IS NULL AND c.file_hash=right(s.run_id,64)
              AND c.vehicle_count=s.received_count
              AND (c.status='ready' OR (c.status='unchanged' AND origin.status='ready' AND origin.file_hash=c.file_hash))
              AND coalesce(c.candidate,origin.candidate)#>>'{metadata,feedId}'=s.feed_id
              AND coalesce(c.candidate,origin.candidate)#>>'{metadata,retailerId}'=s.official_retailer)
        END)
      AND v.source_status='live' AND v.missing_count=0 AND NOT v.price_review_required AS availability_confirmed
    FROM vehicles v
    WHERE v.dealer_id=${dealer} AND v.source='cazoo' AND v.archived_at IS NULL
      AND ${registration} IN (
        regexp_replace(upper(coalesce(v.registration,'')),'[[:space:]-]','','g'),
        regexp_replace(upper(coalesce(v.vrm,'')),'[[:space:]-]','','g'),
        regexp_replace(upper(coalesce(v.plate,'')),'[[:space:]-]','','g'))
    LIMIT 2
  `)).rows;
  if (cars.length !== 1 || cars[0]!.id !== enquiry.vehicleId) return null;
  const car = cars[0]!;
  const decision = decideCazooAutomaticFirstReply({
    enabled: true,
    isFirstReply: true,
    customerMessage: enquiry.message,
    requestedRegistration: registration,
    matchedVehicle: {
      title: String(car.website_title_override || car.title || `${car.make || ""} ${car.model || ""}`.trim()),
      registration: vehicleRegistration({ plate: car.plate as string, vrm: car.vrm as string, registration: car.registration as string }).replace(/[\s-]/g, ""),
      status: String(car.inventory_status),
      availabilityConfirmed: car.availability_confirmed === true,
    },
    dealerName,
  });
  return decision.action === "send" ? decision : null;
}

async function cazooFirstReplyAlreadyQueued(receipt: CazooFirstReplyReceipt, executor: Pick<typeof db, "execute">) {
  return Boolean((await executor.execute(sql`
    SELECT 1 FROM enquiry_emails m JOIN email_outbox q
      ON q.dealer_id=m.dealer_id AND q.enquiry_id=m.enquiry_id AND q.delivery_id=m.id
    WHERE m.dealer_id=${receipt.dealer_id} AND m.enquiry_id=${receipt.enquiry_id}::uuid
      AND m.created_by=${cazooFirstReplyActor} AND m.request_id=${receipt.id}::uuid
      AND q.kind='staff' AND q.send_key=${cazooFirstReplyKey(receipt.id)}
  `)).rows[0]);
}

async function cazooFirstReplySettings(receipt: CazooFirstReplyReceipt, suppliedConfig?: PrivateDealerSettings) {
  const replies = replyConfiguration(receipt.dealer_id);
  if (!replies) return null;
  const { cazooDraftAutomationEligibility } = await import("../lib/cazoo-leads");
  if (!(await cazooDraftAutomationEligibility(receipt.dealer_id, receipt.mailbox)).automaticRepliesEnabled) return null;
  const config = suppliedConfig ?? await dealerIntegrationsStore.readPrivate();
  const resend = effectiveResendSettings(config);
  if (!resend.enabled || !integrationReadiness({ ...config, resend }).resend.ready) return null;
  return { config, resend, replies };
}

async function cazooFirstReplyRouteExists(
  receipt: CazooFirstReplyReceipt,
  to: string,
  domain: string,
  executor: Pick<typeof db, "execute">,
) {
  return Boolean((await executor.execute(sql`
    SELECT 1 FROM enquiry_email_reply_routes
    WHERE dealer_id=${receipt.dealer_id} AND enquiry_id=${receipt.enquiry_id}::uuid
      AND send_key=${cazooFirstReplyKey(receipt.id)} AND recipient=${to}
      AND split_part(reply_address,'@',2)=${domain}
  `)).rows[0]);
}

export async function queueCazooAutomaticFirstReply(receipt: CazooFirstReplyReceipt): Promise<boolean> {
  const { dealer_id: dealer, enquiry_id: id } = receipt;
  if (dealer !== currentDealerId() || !uuid(id) || !uuid(receipt.id) || receipt.error_code !== null) return false;
  if (await cazooFirstReplyAlreadyQueued(receipt, db)) return true;
  const settings = await cazooFirstReplySettings(receipt);
  if (!settings) return false;
  const profile = await dealerProfile();
  return withEmailPreparation(() => db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key(dealer, id)}))`);
    if (await cazooFirstReplyAlreadyQueued(receipt, tx)) return true;
    const [enquiry] = await tx.select().from(enquiriesTable)
      .where(and(eq(enquiriesTable.id, id), eq(enquiriesTable.dealerId, dealer))).for("update");
    if (!enquiry) return false;
    const decision = await cazooFirstReplyCandidate(receipt, enquiry, profile.identity.name, tx);
    if (!decision) return false;
    const input = draftSchema.safeParse({
      to: enquiry.email,
      subject: decision.subject,
      message: decision.bodyText,
      includeVehicle: false,
      includeAppointment: false,
      photoIds: [],
      expectedRevision: enquiry.workspaceRevision + 1,
    });
    if (!input.success) return false;
    // Invalidate staff previews created before the automatic reply was queued.
    await tx.update(enquiriesTable).set({ workspaceRevision: input.data.expectedRevision })
      .where(and(eq(enquiriesTable.id, id), eq(enquiriesTable.dealerId, dealer)));
    const result = await preview(id, input.data, settings.config, profile, tx as unknown as typeof db);
    const deliveryId = randomUUID();
    await tx.insert(enquiryEmailsTable).values({
      id: deliveryId,
      dealerId: dealer,
      enquiryId: id,
      requestId: receipt.id,
      requestHash: hash(JSON.stringify(input.data)),
      status: "sending",
      recipient: input.data.to,
      subject: result.rendered.subject,
      message: result.rendered.bodyText,
      renderedText: result.rendered.text,
      createdBy: cazooFirstReplyActor,
    });
    await enqueueEmailOutbox({
      enquiryId: id,
      deliveryId,
      kind: "staff",
      config: settings.resend,
      request: { to: input.data.to, ...result.rendered, idempotencyKey: cazooFirstReplyKey(receipt.id), attachments: [] },
      validation: {
        input: input.data,
        layoutVersion: "correspondence-v1",
        previewHash: result.previewHash,
        cazooFirstReply: { receiptId: receipt.id, mailbox: receipt.mailbox, rule: decision.rule },
      },
    }, tx);
    if (!await cazooFirstReplyRouteExists(receipt, input.data.to, settings.replies.domain, tx))
      throw new Error("The automatic reply needs a customer reply route.");
    await tx.insert(enquiryEventsTable).values({
      dealerId: dealer,
      enquiryId: id,
      actor: "system",
      kind: "conversation_logged",
      summary: "Automatic availability reply queued",
      detail: { channel: "email", direction: "outbound", source: "cazoo", rule: decision.rule },
    });
    return true;
  }));
}

const cazooFirstReplyApproval = z.object({
  receiptId: z.string().uuid(),
  mailbox: z.string().email(),
  rule: z.literal("simple_availability_v1"),
}).strict();

async function rebuildCazooFirstReply(row: EmailOutbox, suppliedConfig?: PrivateDealerSettings): Promise<EmailRequest> {
  const approval = cazooFirstReplyApproval.safeParse(row.validation.cazooFirstReply);
  const input = draftSchema.safeParse(row.validation.input);
  const noLongerEligible = () => row.attempts === 1
    ? new EmailProviderError(422, null, "cazoo_first_reply_no_longer_eligible", false)
    : new Error("Automatic reply eligibility changed after an earlier delivery attempt.");
  if (!approval.success || !input.success || !row.delivery_id || row.send_key !== cazooFirstReplyKey(approval.data.receiptId))
    throw noLongerEligible();
  const receipt = { id: approval.data.receiptId, enquiry_id: row.enquiry_id, dealer_id: row.dealer_id, mailbox: approval.data.mailbox };
  const settings = await cazooFirstReplySettings(receipt, suppliedConfig);
  if (!settings || !await cazooFirstReplyRouteExists(receipt, input.data.to, settings.replies.domain, db))
    throw noLongerEligible();
  const [enquiry] = await db.select().from(enquiriesTable)
    .where(and(eq(enquiriesTable.id, receipt.enquiry_id), eq(enquiriesTable.dealerId, receipt.dealer_id)));
  const [delivery] = await db.select().from(enquiryEmailsTable).where(and(
    eq(enquiryEmailsTable.id, row.delivery_id),
    eq(enquiryEmailsTable.dealerId, receipt.dealer_id),
    eq(enquiryEmailsTable.enquiryId, receipt.enquiry_id),
    eq(enquiryEmailsTable.createdBy, cazooFirstReplyActor),
    eq(enquiryEmailsTable.requestId, receipt.id),
  ));
  if (!enquiry || !delivery || delivery.status !== "sending" ||
    enquiry.email?.trim().toLowerCase() !== input.data.to || delivery.recipient !== input.data.to ||
    enquiry.workspaceRevision !== input.data.expectedRevision) throw noLongerEligible();
  const profile = await dealerProfile();
  const decision = await cazooFirstReplyCandidate(receipt, enquiry, profile.identity.name, db, delivery.id);
  if (!decision || decision.subject !== input.data.subject || decision.bodyText !== input.data.message)
    throw noLongerEligible();
  const result = await preview(row.enquiry_id, input.data, settings.config, profile);
  if (result.previewHash !== row.validation.previewHash || result.attachments.length) throw noLongerEligible();
  return { to: input.data.to, ...result.rendered, idempotencyKey: row.send_key, attachments: [] };
}

export async function rebuildStaffOutboxEmail(
  row: EmailOutbox,
  suppliedConfig?: PrivateDealerSettings,
): Promise<EmailRequest> {
  if (row.kind !== "staff" || row.dealer_id !== currentDealerId())
    throw new Error("The approved email context is invalid.");
  if (row.validation.cazooFirstReply) return rebuildCazooFirstReply(row, suppliedConfig);
  if(row.validation.input?.stockChange)throw new Error('This retired stock-update email needs manual review.');
  if (row.validation.saleDocument) {
    const {rebuildSaleDocumentOutbox}=await import('../lib/sale-document-email');
    return rebuildSaleDocumentOutbox(row);
  }
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
  await requireReplyRecipient(row.enquiry_id, row.validation.enquiryReplyId, input.to);
  if (row.validation.enquiryReplyId && !replyConfiguration())
    throw new Error("The approved reply connection is no longer available.");
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

/** Project the approved envelope without issuing a reply address or sending. */
async function staffPreviewDelivery(
  config: PrivateDealerSettings,
  request: Pick<EmailRequest, "to" | "subject" | "html" | "text">,
  executor?: unknown,
) {
  try {
    const { body } = await prepareEmailWithSettings(
      effectiveResendSettings(config),
      { ...request, idempotencyKey: "preview" },
      executor,
    );
    const replyDomain = !currentTenant()?.demo && body.to[0] === request.to
      ? replyConfiguration()?.domain ?? null
      : null;
    return {
      from: body.from,
      repliesInInbox: replyDomain !== null,
      routingHash: hash(JSON.stringify({
        from: body.from,
        to: body.to,
        replyRoute: replyDomain ?? body.reply_to ?? null,
      })),
    };
  } catch {
    // Wording can still be reviewed when delivery isn't ready.
    return { from: null, repliesInInbox: false, routingHash: null };
  }
}
const staffApprovalHash = (contentHash: string, routingHash: string | null, enquiryReplyId?: string) =>
  hash(JSON.stringify({ contentHash, routingHash, enquiryReplyId }));

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
    if (error instanceof EmailError || error instanceof EnquiryGalleryError || error instanceof EnquiryVehiclePdfError) {
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
      const enquiry = await entry(String(req.params.id), db, true),
        config = await deps.settings(),
        profile = await dealerProfile();
      const replyId = req.query.enquiryReplyId;
      const acceptedReply = typeof replyId === "string" && !enquiry.archivedAt
        ? await acceptedEnquiryReply(enquiry.id, replyId)
        : null;
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
              }).format(enquiry.appointmentAt)
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
            }).format(enquiry.appointmentAt)
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
      const activeStock=(await dealerIntegrationsStore.readStockConnection()).connection.platform;
      const linkedVehicle=enquiry.vehicleId ? (await db.execute(sql`SELECT id,make,model,COALESCE(website_title_override,title) AS title FROM vehicles WHERE id=${enquiry.vehicleId}::uuid AND dealer_id=${enquiry.dealerId} AND source=${activeStock} AND source_status='live' AND inventory_status IN ('available','reserved') AND archived_at IS NULL`)).rows[0] : undefined;
      res.json({
        ...(await readEmailDraft(enquiry.dealerId, enquiry.id)),
        templates,
        invoices,
        email: enquiry.email || String((await db.execute(sql`SELECT recipient FROM enquiry_email_reply_routes WHERE dealer_id=${enquiry.dealerId} AND enquiry_id=${enquiry.id}::uuid ORDER BY created_at DESC,id DESC LIMIT 1`)).rows[0]?.recipient || ""),
        ...(replyId !== undefined ? { replyRecipient: acceptedReply ? { id: acceptedReply.id, from: acceptedReply.from, subject: acceptedReply.subject } : null } : {}),
        customerName: enquiry.customerName,
        vehicleId: enquiry.vehicleId,
        vehicleTitle: enquiry.vehicleTitle,
        vehicleUrl: linkedVehicle ? `${siteOrigin()}${await publicVehicleDetailPath({ id: String(linkedVehicle.id), make: typeof linkedVehicle.make === 'string' ? linkedVehicle.make : null, model: typeof linkedVehicle.model === 'string' ? linkedVehicle.model : null, title: typeof linkedVehicle.title === 'string' ? linkedVehicle.title : null })}` : null,
        reference: enquiry.reference,
        revision: enquiry.workspaceRevision,
        vehicleAvailable: Boolean(linkedVehicle),
        vehiclePdfAvailable: Boolean(enquiry.vehicleId && await findVisibleStockVehicle(enquiry.vehicleId)),
        appointmentAvailable: Boolean(enquiry.appointmentAt),
        reviewRequest: Boolean(reviewReminderEmail(enquiry.followUpNote, enquiry.customerName, enquiry.vehicleTitle || '', profile.identity.name)),
        defaults: reviewReminderEmail(enquiry.followUpNote, enquiry.customerName, enquiry.vehicleTitle || '', profile.identity.name) || { subject: defaults.subject, message: defaults.bodyText },
        ready,
        photos,
        ...(await enquiryGalleryContext(enquiry)),
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
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Check the email address, subject, message and attachments.",
      });
      return;
    }
    try {
      const config = await deps.settings();
      await requireReplyRecipient(String(req.params.id), parsed.data.enquiryReplyId, parsed.data.to);
      const result = await preview(
        String(req.params.id),
        parsed.data,
        config,
        await dealerProfile(),
      );
      const delivery = await staffPreviewDelivery(config, { to: parsed.data.to, ...result.rendered });
      res.json({
        to: parsed.data.to,
        from: delivery.from,
        repliesInInbox: delivery.repliesInInbox,
        subject: result.rendered.subject,
        text: result.rendered.text,
        html: result.rendered.html,
        previewHash: staffApprovalHash(result.previewHash, delivery.routingHash, parsed.data.enquiryReplyId),
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
              ...input,
              // Keep retries of emails approved before the PDF option existed
              // byte-for-byte compatible when no PDF was requested.
              attachVehiclePdf: input.attachVehiclePdf || undefined,
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
          const automaticReply = (await tx.execute(sql`
            SELECT 1 FROM enquiry_emails
            WHERE dealer_id=${dealer} AND enquiry_id=${id}::uuid
              AND created_by=${cazooFirstReplyActor} AND status='sending'
            LIMIT 1
          `)).rows[0];
          if (automaticReply) throw new EmailError(
            "An automatic reply is being sent. Wait for its delivery status before sending another email.",
            409,
          );
          await requireReplyRecipient(id, input.enquiryReplyId, input.to, tx);
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
              enquiryReplyId: _reply,
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
          const reviewedDelivery = await staffPreviewDelivery(config, { to: input.to, ...result.rendered }, tx);
          if (input.enquiryReplyId && !reviewedDelivery.repliesInInbox)
            throw new EmailError("Sending from this link is paused until the dealership can receive replies in the Inbox.", 409);
          if (!reviewedDelivery.from || staffApprovalHash(result.previewHash, reviewedDelivery.routingHash, input.enquiryReplyId) !== input.previewHash)
            throw new EmailError(
              "The email details, attachments or sender changed. Review the email again.",
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
            enquiryReplyId,
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
                // The outbox independently verifies the final envelope and
                // keeps its existing content hash compatible with older sends.
                previewHash: result.previewHash,
                ...(enquiryReplyId ? { enquiryReplyId } : {}),
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
                      ...(envelope.headers?.["In-Reply-To"] && envelope.headers.References
                        ? { replyHeaders: {
                            "In-Reply-To": envelope.headers["In-Reply-To"],
                            References: envelope.headers.References,
                          } }
                        : {}),
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
            note: `To: ${input.to}\nSubject: ${result!.rendered.subject}\n${result!.rendered.bodyText}\n${input.photoIds.length} photo(s) and ${input.documentIds.length} invoice(s) attached.${input.attachVehiclePdf ? "\nVehicle PDF attached." : ""}${input.vehiclePhotoIndices.length ? `\n${input.vehiclePhotoIndices.length} car photo link(s) included.` : ""}${finished.error ? "\n" + finished.error : ""}`,
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
