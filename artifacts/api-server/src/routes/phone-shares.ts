import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { protectedEmailText, renderWhatsAppTemplate, validateWhatsAppMessage, whatsappTemplateIds } from '@workspace/vehicle-meta';
import { pool } from "@workspace/db";
import {
  requireStaff,
  requirePermission,
  staffHasPermission,
} from "../middlewares/staff-auth";
import { currentDealerId } from "../lib/tenant-context";
import { siteOrigin } from "../lib/enquiry-links";
import {
  PhoneShareError,
  phoneShareHash,
  validPhoneToken,
  validatePhoneSharePayload,
  type PhoneSharePayload,
} from "../lib/phone-share";
import {
  PostgresSaleWorkspaceStore,
  readSaleWorkspaceAssets,
} from "../lib/sale-workspace-store";
import { dealerIntegrationsStore } from "../lib/dealer-integrations-store";
import { dealerProfile } from "../lib/enquiry-notifications";
import { draftSchema, previewEnquiryEmail } from "./enquiry-emails";
import { renderDealerEmail } from "../lib/email-provider";
import { listStripeReservations } from "../lib/stripe-reservation-store";
import { customerEmailPreparationRouter } from "../lib/customer-email-preparation";
import { mediaRequestIdentity } from "../lib/enquiry-media";
import { whatsappConfirmationRouter } from "../lib/whatsapp-confirmation";
const router = Router();
const input = z
  .object({
    requestId: z.string().uuid(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
    messageBody: z.string().max(4000).optional(),
    templateId: z.enum(whatsappTemplateIds).optional(),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal('message'), message: z.string().trim().min(1).max(12000), url: z.string().max(2048).optional(), enquiryId: z.string().uuid().optional(), vehicleId: z.string().uuid().optional() }).strict(),
      z
        .object({
          kind: z.literal("document"),
          saleId: z.string().uuid(),
          documentId: z.string().uuid(),
          taxReference: z
            .string()
            .regex(/^\d{12}$/)
            .optional(),
        })
        .strict(),
      z.object({ kind: z.literal("reservation"), reservationId: z.string().uuid() }).strict(),
      z.object({ kind: z.literal("enquiry-message"), enquiryId: z.string().uuid(),
        draft: draftSchema.extend({to: z.union([z.string().trim().toLowerCase().max(254).email(), z.literal("")])}),
      }).strict(),
      z
        .object({
          kind: z.literal("enquiry"),
          enquiryId: z.string().uuid(),
          draft: draftSchema,
          previewHash: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ]),
  })
  .strict();
const privateHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};
router.use(["/staff/phone-shares", "/phone-shares"], (_req, res, next) => {
  res.set(privateHeaders);
  next();
});
router.use("/staff/phone-shares", requireStaff);
router.use("/staff/phone-shares", customerEmailPreparationRouter());
router.use("/staff/phone-shares", whatsappConfirmationRouter());
router.post(
  "/staff/phone-shares",
  (req, res, next) =>
    req.body?.source?.kind === "document"
      ? requirePermission("payments.record")(req, res, next)
      : requirePermission("sales.manage")(req, res, next),
  async (req, res) => {
    try {
      const parsed = input.safeParse(req.body);
      if (!parsed.success)
        throw new PhoneShareError("Check the sharing request.", 400);
      const data = parsed.data,
        dealer = currentDealerId(),
        tokenHash = phoneShareHash(data.token),
        sourceIdentity = "draft" in data.source ? {...data.source, draft: mediaRequestIdentity(data.source.draft)} : data.source,
        fingerprint = phoneShareHash(JSON.stringify(data.messageBody !== undefined || data.templateId !== undefined
          ? { source: sourceIdentity, ...(data.messageBody !== undefined ? { messageBody: data.messageBody } : {}), ...(data.templateId !== undefined ? { templateId: data.templateId } : {}) }
          : sourceIdentity));
      const previous = (
        await pool.query(
          "SELECT id,token_hash,fingerprint,expires_at,revoked_at,payload FROM customer_phone_shares WHERE dealer_id=$1 AND request_id=$2",
          [dealer, data.requestId],
        )
      ).rows[0];
      const result = (row: any, replayed: boolean) => ({
        id: row.id,
        url: `${siteOrigin()}/phone-share#${data.token}`,
        expiresAt: row.expires_at,
        replayed,
        message: row.payload?.message || "",
        messageBody: row.payload?.messageBody ?? row.payload?.message ?? '',
        requiredText: row.payload?.requiredText || '',
        templateId: row.payload?.templateId,
        templateVariables: row.payload?.templateVariables || {},
        messageLinkRequired: row.payload?.messageLinkRequired || false,
        customerPhone: row.payload?.customerPhone || "",
        hasAttachments: Boolean(row.payload?.files?.length),
        enquiryId: row.payload?.enquiryId || undefined,
        customerEmail: row.payload?.customerEmail || "",
        customerName: row.payload?.customerName || "",
        vehicleId: row.payload?.vehicleId || undefined,
        title: row.payload?.title || "Customer message",
      });
      if (previous) {
        if (
          previous.token_hash !== tokenHash ||
          previous.fingerprint !== fingerprint
        )
          throw new PhoneShareError(
            "This sharing request was already used for different details.",
            409,
          );
        if (
          previous.revoked_at ||
          Date.parse(previous.expires_at) <= Date.now()
        )
          throw new PhoneShareError(
            "This link expired or was revoked. Create a new one.",
            410,
          );
        res.json(result(previous, true));
        return;
      }
      if (!(await dealerIntegrationsStore.readPhoneSharing()).enabled)
        throw new PhoneShareError('WhatsApp QR sharing is turned off in Settings → Emails & documents → WhatsApp & QR. Use email instead.', 409);
      let payload: PhoneSharePayload;
      if (data.source.kind === 'message') {
        const source = data.source;
        const enquiry = source.enquiryId ? (await pool.query('SELECT customer_name,phone,email,vehicle_id,vehicle_title,vehicle_registration,appointment_at FROM enquiries WHERE dealer_id=$1 AND id=$2', [dealer, source.enquiryId])).rows[0] : undefined;
        if (source.enquiryId && !enquiry) throw new PhoneShareError('Enquiry not found.', 404);
        const vehicleId = source.vehicleId || enquiry?.vehicle_id;
        const vehicle = vehicleId ? (await pool.query('SELECT id,title,registration FROM vehicles WHERE dealer_id=$1 AND id=$2', [dealer, vehicleId])).rows[0] : undefined;
        if (vehicleId && !vehicle) throw new PhoneShareError('Vehicle not found.', 404);
        let url = '';
        if (source.url) {
          try {
            const target = new URL(source.url, siteOrigin());
            if (target.origin !== siteOrigin() || target.username || target.password || !/^\/(?:vehicle|test-drive-declaration|my-purchase|viewing|customer-details)\/[A-Za-z0-9_-]+\/?$/.test(target.pathname)) throw new Error();
            if (target.pathname.startsWith('/vehicle/')) {
              const id = target.pathname.split('/')[2];
              if (!z.string().uuid().safeParse(id).success || !(await pool.query('SELECT id FROM vehicles WHERE dealer_id=$1 AND id=$2', [dealer, id])).rows.length) throw new PhoneShareError('Vehicle not found.', 404);
            }
            url = target.href;
          } catch (error) { if (error instanceof PhoneShareError) throw error; throw new PhoneShareError('Use a customer link from this dealership website.', 400); }
        }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source.message)) throw new PhoneShareError('Use plain text without control characters.', 400);
        const profile = await dealerProfile();
        payload = {
          title: 'Customer message', message: [source.message, url].filter(Boolean).join('\n\n'),
          messageBody: source.message, requiredText: url, templateId: 'enquiry', messageLinkRequired: true,
          templateVariables: { customer_name: enquiry?.customer_name || '', dealer_name: profile.identity.name, vehicle_title: vehicle?.title || enquiry?.vehicle_title || '', vehicle_registration: vehicle?.registration || enquiry?.vehicle_registration || '', appointment_time: enquiry?.appointment_at ? new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',dateStyle:'full',timeStyle:'short'}).format(new Date(enquiry.appointment_at)) + ' (UK time)' : '', message: source.message },
          enquiryId: source.enquiryId, vehicleId: vehicle?.id, customerPhone: enquiry?.phone || '', customerEmail: enquiry?.email || '', customerName: enquiry?.customer_name || '', files: [],
        };
      } else if (data.source.kind === "document") {
        const service = new PostgresSaleWorkspaceStore(
          dealer,
          (draft, client) => readSaleWorkspaceAssets(draft, dealer, client),
          pool,
        );
        const { document, archive } = await service.pdf(
          data.source.saleId,
          data.source.documentId,
        );
        // WhatsApp shares the issued PDF only. The Road Tax guide belongs to
        // the invoice email flow and must not block sharing an existing invoice.
        const attachments = [{ filename: `${document.number}.pdf`, content: archive.content }];
        const draft = document.snapshot.draft;
        const branding = document.snapshot.branding;
        const money = (pence: number) => new Intl.NumberFormat('en-GB', {style:'currency', currency:'GBP'}).format(pence / 100);
        const rendered = await renderDealerEmail({
          templateId: document.type === 'invoice' ? 'invoice' : document.type === 'statement' ? 'balance_statement' : document.type === 'receipt' ? 'payment_receipt' : 'document_email',
          variables: {customer_name: draft.customer, customer_email: draft.email, dealer_name: branding.identity.name, dealer_email: branding.contact?.email, dealer_phone: branding.contact?.phone, vehicle_title: draft.vehicle, vehicle_registration: draft.registration, document_title: document.title, document_type: document.title, document_number: document.number, issued_at: document.issuedAt, amount: money(document.paymentAmountPence ?? document.snapshot.totals?.totalDue ?? 0), amount_received: money(document.snapshot.totals?.confirmedPaid ?? 0), balance: money(document.balanceAtIssue ?? 0)},
          facts: [{label:'Document',value:`${document.title} ${document.number}`},{label:'Vehicle',value:draft.vehicle},...(draft.registration ? [{label:'Registration',value:draft.registration}] : []),...(document.issuedAt ? [{label:'Issued',value:new Date(document.issuedAt).toLocaleString('en-GB',{timeZone:'Europe/London'})}] : []),...(document.paymentAmountPence != null ? [{label:'Receipt amount',value:money(document.paymentAmountPence)}] : []),{label:'Payments recorded at issue',value:money(document.snapshot.totals?.confirmedPaid ?? 0)},{label:'Balance at issue',value:money(document.balanceAtIssue ?? 0)},...(attachments.length > 1 ? [{label:'Attachments',value:'Invoice and Road Tax guide'}] : [])],
          attachments,
        });
        payload = {
          confirmationScope: "document",
          enquiryId: draft.sourceEnquiryId,
          customerEmail: draft.email || "",
          customerName: draft.customer,
          vehicleId: draft.vehicleId || undefined,
          customerPhone: draft.phone || "",
          title: rendered.subject,
          message: rendered.text,
          messageBody: rendered.bodyText,
          requiredText: protectedEmailText(rendered),
          templateId: 'invoice',
          templateVariables: { customer_name: draft.customer, dealer_name: branding.identity.name, vehicle_title: draft.vehicle, vehicle_registration: draft.registration, message: rendered.bodyText },
          files: attachments.map((file) => ({
            ...file,
            filename: file.filename.replace(/[^\w .()-]/g, "_"),
            contentType: "application/pdf",
          })),
        };
      } else if (data.source.kind === "reservation") {
        const reservationId = data.source.reservationId;
        const record = (await listStripeReservations(dealer)).find(row => row.id === reservationId);
        if (!record) throw new PhoneShareError("Reservation not found.", 404);
        const refund = record.amountRefundedPence > 0;
        const kind = refund ? 'reservation_refund' : record.paymentStatus === 'confirmed' ? 'reservation_payment' : 'reservation_confirmation';
        if (refund && !['partially_refunded', 'refunded'].includes(record.paymentStatus)) throw new PhoneShareError("The refund is not confirmed. Review this reservation first.", 409);
        const profile = await dealerProfile();
        const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
        const files: PhoneSharePayload['files'] = [];
        let documentNumber = '';
        if (record.saleId && kind !== 'reservation_confirmation') {
          const sale = (await pool.query('SELECT state FROM sale_workspace WHERE dealer_id=$1 AND id=$2::uuid', [dealer, record.saleId])).rows[0]?.state;
          const document = [...(sale?.documents ?? [])].reverse().find((item: any) => item.type === 'receipt' && item.snapshot.payments.some((payment: any) => payment.id === item.paymentId && payment.kind === (refund ? 'refund' : 'deposit')));
          const archive = document && sale?.documentArchives?.[document.id];
          if (archive && document) { documentNumber = document.number; files.push({filename: `${document.number.replace(/[^a-zA-Z0-9_-]/g, '-')}.pdf`, content: archive.content, contentType: 'application/pdf'}); }
        }
        const rendered = await renderDealerEmail({templateId: kind,
          variables: {dealer_name: profile.identity.name, dealer_email: profile.contact.email, dealer_phone: profile.contact.phone, customer_name: record.customerName, customer_email: record.email, reference: record.reference, vehicle_title: record.vehicleTitle, vehicle_registration: record.vehicleRegistration, amount: money(record.depositPence), amount_received: money(record.amountReceivedPence), payment_status: record.paymentStatus, reservation_status: record.status, document_number: documentNumber, expires_at: new Date(record.expiresAt).toLocaleString('en-GB', {timeZone:'Europe/London'})},
          facts: [{label:'Vehicle',value:record.vehicleTitle},{label:'Reservation status',value:record.status.replaceAll('_',' ')},{label:'Payment status',value:record.paymentStatus.replaceAll('_',' ')},{label:'Requested deposit',value:money(record.depositPence)},{label:'Amount received',value:money(record.amountReceivedPence)},{label:'Amount refunded',value:money(record.amountRefundedPence)},...(record.mode === 'test' ? [{label:'Payment mode',value:'Stripe test payment — no real funds received'}] : [])], attachments: files });
        payload = {title: rendered.subject, message: rendered.text, messageBody: rendered.bodyText, requiredText: protectedEmailText(rendered), templateId: 'reservation', templateVariables: { customer_name: record.customerName, dealer_name: profile.identity.name, vehicle_title: record.vehicleTitle, vehicle_registration: record.vehicleRegistration, message: rendered.bodyText }, customerPhone: record.phone, customerEmail: record.email, customerName: record.customerName, vehicleId: record.vehicleId || undefined, files};
      } else {
        const prepared = await previewEnquiryEmail(
          data.source.enquiryId,
          data.source.draft,
          await dealerIntegrationsStore.readPrivate(),
          await dealerProfile(),
        );
        if (data.source.kind === "enquiry" && prepared.previewHash !== data.source.previewHash)
          throw new PhoneShareError(
            "The message changed. Review it again before creating a QR code.",
            409,
          );
        payload = {
          enquiryId: prepared.enquiry.id,
          customerEmail: prepared.enquiry.email || "",
          customerName: prepared.enquiry.customerName,
          vehicleId: prepared.enquiry.vehicleId || undefined,
          customerPhone: prepared.enquiry.phone || "",
          title: data.source.draft.subject,
          message: prepared.rendered.text,
          messageBody: prepared.rendered.bodyText,
          requiredText: protectedEmailText(prepared.rendered),
          templateId: data.source.draft.includeAppointment ? 'appointment' : data.source.draft.includeVideo ? 'video' : data.source.draft.customPhotoIds.length || data.source.draft.photoIds.length || data.source.draft.vehiclePhotoIndices.length ? 'photos' : data.source.draft.includeVehicle ? 'vehicle_details' : 'enquiry',
          templateVariables: prepared.whatsappVariables,
          files: prepared.attachments.map((file) => ({
            filename: file.filename.replace(/[^\w .()-]/g, "_"),
            content: file.content,
            contentType: file.filename.toLowerCase().endsWith(".pdf")
              ? "application/pdf"
              : file.filename.toLowerCase().endsWith(".ics")
                ? "text/calendar"
                : file.filename.toLowerCase().endsWith(".png")
                  ? "image/png"
                  : "image/jpeg",
          })),
        };
      }
      if (data.messageBody !== undefined || data.templateId !== undefined) {
        // Only prose is editable. All factual details and files above came from the
        // authorised source and are frozen with the new sharing pack.
        const template = data.templateId ? (await dealerIntegrationsStore.listWhatsAppTemplates()).templates.find(item => item.id === data.templateId) : undefined;
        payload.messageBody = validateWhatsAppMessage(data.messageBody !== undefined ? data.messageBody : renderWhatsAppTemplate(template!, payload.templateVariables ?? {}));
        payload.templateId = data.templateId ?? payload.templateId;
        payload.message = [payload.messageBody, payload.requiredText].filter(Boolean).join('\n\n');
      }
      validatePhoneSharePayload(payload);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `phone-shares:${dealer}`,
        ]);
        // Preparation happens before this transaction. A test enquiry may have
        // been deleted meanwhile; never create a fresh capability for that row.
        if (payload.enquiryId && !(await client.query('SELECT id FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid FOR KEY SHARE', [dealer, payload.enquiryId])).rows.length) {
          throw new PhoneShareError('Enquiry not found. Refresh before sharing.', 404);
        }
        const concurrent = (
          await client.query(
            "SELECT id,token_hash,fingerprint,expires_at,revoked_at,payload FROM customer_phone_shares WHERE dealer_id=$1 AND request_id=$2",
            [dealer, data.requestId],
          )
        ).rows[0];
        if (concurrent) {
          if (
            concurrent.token_hash !== tokenHash ||
            concurrent.fingerprint !== fingerprint ||
            concurrent.revoked_at ||
            Date.parse(concurrent.expires_at) <= Date.now()
          )
            throw new PhoneShareError(
              "This sharing request changed or expired.",
              409,
            );
          await client.query("COMMIT");
          res.json(result(concurrent, true));
          return;
        }
        // Purge expired content as this dealership creates new links; keep only the small audit row.
        await client.query(
          "UPDATE customer_phone_shares SET payload='{}'::jsonb WHERE dealer_id=$1 AND expires_at<=now() AND payload<>'{}'::jsonb",
          [dealer],
        );
        const quota = (
          await client.query(
            "SELECT count(*) AS count,coalesce(sum(octet_length(payload::text)),0) AS bytes FROM customer_phone_shares WHERE dealer_id=$1 AND created_at>now()-interval '1 day'",
            [dealer],
          )
        ).rows[0];
        if (
          Number(quota.count) >= 50 ||
          Number(quota.bytes) + Buffer.byteLength(JSON.stringify(payload)) >
            32 * 1024 * 1024
        )
          throw new PhoneShareError(
            "Today’s sharing allowance is full. Reuse an existing link or try later.",
            429,
          );
        const row = (
          await client.query(
            "INSERT INTO customer_phone_shares(id,dealer_id,request_id,token_hash,fingerprint,payload,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,now()+interval '1 day') RETURNING id,expires_at,payload",
            [
              randomUUID(),
              dealer,
              data.requestId,
              tokenHash,
              fingerprint,
              JSON.stringify(payload),
              req.staff!.authUserId,
            ],
          )
        ).rows[0];
        await client.query("COMMIT");
        res.status(201).json(result(row, false));
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (
        error instanceof PhoneShareError ||
        (error &&
          typeof error === "object" &&
          "status" in error &&
          typeof error.status === "number")
      ) {
        res
          .status((error as PhoneShareError).status)
          .json({
            error:
              error instanceof Error
                ? error.message
                : "The sharing pack could not be created.",
          });
        return;
      }
      req.log.error("Phone sharing pack preparation failed");
      res
        .status(503)
        .json({
          error: "The sharing pack could not be created. Nothing was sent.",
        });
    }
  },
);
router.post("/staff/phone-shares/:id/revoke", async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.id).success) {
    res.status(404).end();
    return;
  }
  const row = await pool.query(
    "UPDATE customer_phone_shares SET revoked_at=coalesce(revoked_at,now()),payload='{}'::jsonb WHERE id=$1 AND dealer_id=$2 AND (created_by=$3 OR $4) RETURNING id",
    [
      req.params.id,
      currentDealerId(),
      req.staff!.authUserId,
      staffHasPermission(req, "sales.manage"),
    ],
  );
  res
    .status(row.rows.length ? 200 : 404)
    .json({ revoked: Boolean(row.rows.length) });
});
router.get("/phone-shares", async (req, res) => {
  const token = req.get("x-phone-share-token");
  if (!validPhoneToken(token)) {
    res.status(404).json({ error: "This sharing link is unavailable." });
    return;
  }
  try {
    const row = (
      await pool.query(
        "SELECT payload,expires_at FROM customer_phone_shares WHERE dealer_id=$1 AND token_hash=$2 AND revoked_at IS NULL AND expires_at>now()",
        [currentDealerId(), phoneShareHash(token)],
      )
    ).rows[0];
    if (!row) {
      res
        .status(404)
        .json({
          error:
            "This sharing link expired or was revoked. Ask staff for a new link.",
        });
      return;
    }
    // The capability page gets only the approved customer-facing pack. Template
    // variables can retain source prose that staff deliberately edited out.
    res.json({
      customerPhone: row.payload.customerPhone || '',
      title: row.payload.title,
      message: row.payload.message,
      files: row.payload.files,
      expiresAt: row.expires_at,
    });
  } catch {
    res
      .status(503)
      .json({
        error: "The sharing pack is temporarily unavailable. Please try again.",
      });
  }
});
export default router;
