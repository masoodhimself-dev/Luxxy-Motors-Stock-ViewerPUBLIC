import { reviewReminderEmail } from '@workspace/vehicle-meta';
// Isolated local review only. Drafts live in memory; this module has no email transport.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod/v4";
import { createHash } from 'node:crypto';
import { defaultEmailTemplates, defaultEmailAppearance, renderEmailTemplate, type EmailFacts, type EmailTemplate, type EmailAppearance } from '@workspace/vehicle-meta';
import { enquiryGroup } from "../src/lib/enquiry-groups";
import { readPreviewEnquiries, readPreviewSettings } from "./reservations";
import { previewStock } from './stock';
import { previewEnquiryGallery } from './enquiry-gallery';
const drafts = new Map<
  string,
  {
    version: number;
    status: string;
    content: Record<string, any>;
    updatedAt: string;
  }
>();
const contentSchema = z
  .object({
    to: z.union([z.literal(""), z.string().max(254).email()]),
    subject: z.string().max(200),
    message: z.string().max(12000),
    templateId: z.enum(['enquiry_message','invoice_copy','vehicle_details','service_history','pre_accident_photos','appointment_details']).optional(),
    includeVehicle: z.boolean(),
    includeAppointment: z.boolean(),
    photoIds: z.array(z.string()).max(6),
    documentIds: z.array(z.string()).max(3),
    vehiclePhotoIndices: z.array(z.number().int().min(0).max(99)).max(4).default([]),
    expectedRevision: z.number().int().nonnegative(),
    stockChange: z.object({ taskId: z.string().uuid(), revision: z.number().int().nonnegative() }).strict().optional(),
  })
  .strict();
export async function communicationsPreview(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: { readEnquiries?: typeof readPreviewEnquiries; readSettings?: typeof readPreviewSettings; readTemplates?: () => Promise<{ templates: readonly EmailTemplate[]; appearance: EmailAppearance }> } = {},
) {
  const own =
    [
      "/api/staff/notifications",
      "/api/staff/email-drafts",
      "/api/staff/email",
      "/api/staff/email/reply-attention",
      "/api/staff/push",
    ].includes(url.pathname) ||
    url.pathname.startsWith('/api/staff/push/') ||
    /^\/api\/staff\/enquiries\/[^/]+\/email(?:-context|-draft(?:\/discard)?|-preview)?$/.test(
      url.pathname,
    );
  if (!own) return false;
  const send = (status: number, value: unknown) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(value));
  };
  const remote = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  if (
    !["127.0.0.1", "::1"].includes(remote) ||
    !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(
      req.headers.host || "",
    ) ||
    (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
  ) {
    send(403, { error: "Communications preview is loopback-only." });
    return true;
  }
  if (url.pathname === '/api/staff/push' || url.pathname.startsWith('/api/staff/push/')) {
    // This file-backed UI preview has no real staff session, delivery queue or keys.
    // Never turn a preview opt-in into a real push subscription or outbound send.
    if (req.method === 'GET' && url.pathname === '/api/staff/push') {
      send(200, {
        configured: false,
        publicKey: null,
        userId: 'preview-alex',
        actorScope: 'preview:preview-alex',
        subscriptions: [],
        preferences: {
          enquiries: true, bookings: true, reminders: true,
          followups: true, emailFailures: true, reminderMinutes: 30,
        },
      });
    } else {
      send(503, { error: 'Device alerts need the authenticated HTTPS backend. This local preview cannot send notifications.' });
    }
    return true;
  }
  try {
    const enquiries = await (options.readEnquiries ?? readPreviewEnquiries)();
    const scopeId = url.searchParams.get('enquiryId'), scopeEntry = enquiries.find(e => e.id === scopeId);
    const scopeIds = scopeId ? new Set(scopeEntry ? enquiryGroup(scopeEntry, enquiries).map(e => e.id) : []) : null;
    if (req.method === "GET" && url.pathname === "/api/staff/notifications") {
      const items: any[] = [],
        counts = {
          enquiries: 0,
          followups: 0,
          appointments: 0,
          drafts: 0,
          email: 0,
        };
      const today = new Date().toLocaleDateString("en-CA", {
        timeZone: "Europe/London",
      });
      for (const e of enquiries.filter((e) => !e.mergedIntoId)) {
        const add = (
          category: keyof typeof counts,
          detail: string,
          at: string,
          href = `/portal?section=enquiries&enquiryId=${e.id}`,
        ) => {
          counts[category]++;
          if (items.filter((i) => i.category === category).length < 8)
            items.push({
              id: e.id,
              category,
              detail,
              at,
              href,
              customer: e.customerName,
              enquiryId: e.id,
              phone: e.phone,
              preview: e.message?.slice(0,240),
              vehicle: e.vehicleTitle,
              reference: e.reference,
            });
        };
        if (e.status === "new" && !e.callOutcome)
          add("enquiries", "Awaiting a reply", e.createdAt);
        if (
          e.followUpAt &&
          !e.followUpCompletedAt &&
          e.status !== "closed" &&
          Date.parse(e.followUpAt) <= Date.now()
        )
          add("followups", e.followUpNote?.startsWith("Google review request") ? "Google review request" : "Follow-up due", e.followUpAt);
        if (
          e.appointmentAt &&
          !e.appointmentCancelledAt &&
          e.attendance === "scheduled" &&
          e.status !== "closed" &&
          ((e.appointmentStatus === "pending" &&
            Date.parse(e.appointmentAt) >= Date.now()) ||
            new Date(e.appointmentAt).toLocaleDateString("en-CA", {
              timeZone: "Europe/London",
            }) === today)
        )
          add(
            "appointments",
            e.appointmentStatus === "pending"
              ? "Booking needs approval"
              : "Appointment today",
            e.appointmentAt,
          );
        const saved = drafts.get(e.id);
        if (saved?.status === "draft")
          add(
            "drafts",
            "Draft ready to continue",
            saved.updatedAt,
            `/portal?section=email&draft=${e.id}`,
          );
      }
      send(200, {
        generatedAt: new Date().toISOString(),
        counts,
        items,
        emailAccess: true,
        capabilities: {
          aiDrafts: false,
          automaticDrafts: false,
          automaticSending: false,
        },
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/staff/email-drafts") {
      send(200, {
        drafts: [...drafts]
          .filter(([id, d]) => d.status === "draft" && (!scopeIds || scopeIds.has(id)))
          .flatMap(([enquiryId, d]) => {
            const e = enquiries.find(
              (e) => e.id === enquiryId && !e.mergedIntoId,
            );
            return e
              ? [
                  {
                    ...d,
                    content: undefined,
                    enquiryId,
                    source: d.content.templateId ? "template" : "manual",
                    subject: d.content.subject,
                    customerName: e.customerName,
                    vehicleTitle: e.vehicleTitle,
                    reference: e.reference,
                  },
                ]
              : [];
          }),
        hasMore: false,
      });
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/staff/email/reply-attention") { send(200, url.searchParams.has("enquiryId") ? {pending:0,review:0} : {enquiries:[]}); return true; }
    if (req.method === "GET" && url.pathname === "/api/staff/email") {
      send(200, { messages: [], hasMore: false, replyTo: null });
      return true;
    }
    const id = url.pathname.split("/")[4],
      entry = enquiries.find((e) => e.id === id && !e.mergedIntoId);
    if (!entry) {
      send(404, { error: "Enquiry not found." });
      return true;
    }
    const saved = drafts.get(id),
      version = saved?.version ?? 0;
    const settings = await (options.readSettings ?? readPreviewSettings)();
    const templateSettings = options.readTemplates ? await options.readTemplates() : await (await import('./dealer-integrations')).previewIntegrationsStore.listTemplates();
    const appearance = templateSettings.appearance ?? defaultEmailAppearance;
    const address = [settings.address.street, settings.address.city, settings.address.region, settings.address.postcode].filter(Boolean).join(', ');
    const appointmentTime = entry.appointmentAt ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'full', timeStyle: 'short' }).format(new Date(entry.appointmentAt)) + ' (UK time)' : '';
    const appointmentStatus = entry.appointmentAt ? entry.appointmentCancelledAt ? 'Cancelled' : entry.appointmentStatus === 'confirmed' ? 'Confirmed' : 'Awaiting showroom approval' : '';
    const variables = { dealer_name: settings.identity.name, dealer_email: settings.contact.email, dealer_phone: settings.contact.phone, dealer_address: address, customer_name: entry.customerName, customer_email: entry.email || '', reference: entry.reference, vehicle_title: entry.vehicleTitle || 'Your enquiry', vehicle_registration: entry.vehicleRegistration || '', appointment_time: appointmentTime, appointment_status: appointmentStatus, duration: entry.appointmentAt ? `${entry.appointmentDurationMinutes ?? 30} minutes` : '', visit_instructions: entry.appointmentAt ? settings.testDriveBooking?.instructions || settings.presentation?.visitInstructions || '' : '', parking_instructions: entry.appointmentAt ? settings.presentation?.parkingInstructions || '' : '', message: 'Here are the details we discussed. Please let us know if you have any questions.' };
    if (req.method === "GET" && url.pathname.endsWith("/email-context")) {
      const availableTemplates = templateSettings.templates.filter(template => ['enquiry_message','invoice_copy','vehicle_details','service_history','pre_accident_photos','appointment_details'].includes(template.id));
      const baseTemplate = availableTemplates.find(template => template.id === 'enquiry_message') ?? defaultEmailTemplates.find(template => template.id === 'enquiry_message')!;
      const defaults = renderEmailTemplate(baseTemplate, variables, [], { ...appearance, heading: '', footer: '' });
      send(200, {
        version,
        savedDraft: saved?.status === "draft" ? saved : null,
        email: entry.email || "",
        customerName: entry.customerName,
        vehicleId: entry.vehicleId,
        vehicleTitle: entry.vehicleTitle,
        reference: entry.reference,
        revision: entry.workspaceRevision ?? 0,
        vehicleAvailable: !!entry.vehicleTitle,
        appointmentAvailable: !!entry.appointmentAt,
        reviewRequest: Boolean(reviewReminderEmail(entry.followUpNote,entry.customerName,entry.vehicleTitle || '',settings.identity.name)),
        defaults: reviewReminderEmail(entry.followUpNote,entry.customerName,entry.vehicleTitle || '',settings.identity.name) || {subject:defaults.subject,message:defaults.bodyText},
        ready: false,
        templates: availableTemplates.map(template => { const rendered = renderEmailTemplate(template, variables, [], { ...appearance, heading: '', footer: '' }); return { id: template.id, label: template.label, subject: rendered.subject, message: rendered.bodyText }; }),
        invoices: [],
        photos: [],
        ...previewEnquiryGallery(entry.vehicleId),
        deliveries: [],
      });
      return true;
    }
    if (req.method === "POST") {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 30000) {
          send(413, { error: "Draft is too large." });
          return true;
        }
      }
      const body = JSON.parse(raw);
      if (url.pathname.endsWith("/email-draft")) {
        const parsed = contentSchema.safeParse(body.content);
        if (!parsed.success) { send(400,{error:'Check the draft.'});return true; }
        if (parsed.data.stockChange || saved?.content.stockChange) { send(409,{error:'This archived price-update draft cannot be sent. Start a new message from current vehicle details.'});return true; }
        if (
          body.expectedVersion !== version ||
          parsed.data.expectedRevision !== (entry.workspaceRevision ?? 0)
        ) {
          send(409, {
            error: "Draft or enquiry changed. Reopen it before saving.",
          });
          return true;
        }
        const updated = {
          version: version + 1,
          status: "draft",
          content: parsed.data,
          updatedAt: new Date().toISOString(),
        };
        drafts.set(id, updated);
        send(200, { version: updated.version, savedDraft: updated });
        return true;
      }
      if (url.pathname.endsWith("/email-draft/discard")) {
        if (body.expectedVersion !== version || saved?.status !== "draft") {
          send(409, { error: "Draft changed." });
          return true;
        }
        drafts.set(id, {
          version: version + 1,
          status: "discarded",
          content: {},
          updatedAt: new Date().toISOString(),
        });
        send(200, { discarded: true });
        return true;
      }
      if (url.pathname.endsWith("/email-preview")) {
        const parsed = contentSchema.safeParse(body);
        if (
          !parsed.success ||
          !parsed.data.to ||
          !parsed.data.subject.trim() ||
          !parsed.data.message.trim()
        ) {
          send(400, { error: "Add a recipient, subject and message." });
          return true;
        }
        if (parsed.data.expectedRevision !== (entry.workspaceRevision ?? 0)) { send(409, { error: 'The enquiry changed. Reopen the email before reviewing it.' }); return true; }
        if (parsed.data.stockChange) { send(409,{error:'This archived price-update draft cannot be sent. Start a new message from current vehicle details.'});return true; }
        if (parsed.data.templateId === 'invoice_copy' && !parsed.data.documentIds.length) { send(400, { error: 'Attach an invoice for this customer before reviewing this invoice email.' }); return true; }
        if (['service_history','pre_accident_photos'].includes(parsed.data.templateId ?? '') && !parsed.data.photoIds.length) { send(400, { error: 'Attach a matching approved vehicle photo before reviewing this email.' }); return true; }
        if (parsed.data.photoIds.length || parsed.data.documentIds.length) { send(409, { error: 'Private attachments need the authenticated backend. Local preview cannot validate or send them.' }); return true; }
        if (parsed.data.includeAppointment && !entry.appointmentAt) { send(400, { error: 'There is no appointment on this enquiry.' }); return true; }
        const car = previewStock.cars.find(car => car.id === entry.vehicleId);
        const media = previewEnquiryGallery(entry.vehicleId);
        const links:string[]=[];
        for(const index of parsed.data.vehiclePhotoIndices){const photo=media.vehiclePhotos.find(photo=>photo.index===index);if(!photo){send(409,{error:'A car photo changed. Choose it again.'});return true;}links.push(`Car photo ${index+1}: ${photo.url}`);}
        const attachments: Array<{ id: string; filename: string; byteSize: number }> = [];
        const facts: EmailFacts = [];
        if (parsed.data.includeVehicle) {
          if (!car && !entry.vehicleTitle) { send(400, { error: 'There is no vehicle information on this enquiry.' }); return true; }
          facts.push({ label: 'Vehicle', value: car?.title || entry.vehicleTitle }, { label: 'Registration', value: entry.vehicleRegistration });
          if (car?.price != null) facts.push({ label: 'Cash price', value: new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(car.price) });
          if (car?.mileage != null) facts.push({ label: 'Mileage', value: `${car.mileage.toLocaleString('en-GB')} miles` });
        }
        if (parsed.data.includeAppointment) facts.push({ label: 'Appointment', value: appointmentTime }, { label: 'Appointment status', value: appointmentStatus }, { label: 'Showroom', value: address });
        const rendered = renderEmailTemplate({ subject: '{{document_type}}', body: '{{message}}', headline: templateSettings.templates.find(template => template.id === (parsed.data.templateId ?? 'enquiry_message'))?.headline }, { ...variables, customer_email: parsed.data.to, document_type: parsed.data.subject, message: [parsed.data.message,...links].join('\n\n') }, facts, appearance, { templateId: parsed.data.templateId ?? 'enquiry_message' });
        send(200, {
          to: parsed.data.to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          previewHash: createHash('sha256').update(JSON.stringify({ to: parsed.data.to, ...rendered, attachments, stockChange: parsed.data.stockChange })).digest('hex'),
          attachments,
        });
        return true;
      }
    }
    send(503, {
      error:
        "Local preview cannot send email. Use the authenticated backend to test delivery.",
    });
    return true;
  } catch {
    send(400, {
      error: "Could not load or save local preview communications.",
    });
    return true;
  }
}
