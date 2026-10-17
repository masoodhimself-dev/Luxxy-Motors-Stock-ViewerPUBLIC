// Isolated local review only. Drafts live in memory; this module has no email transport.
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod/v4";
import { enquiryGroup } from "../src/lib/enquiry-groups";
import { readPreviewEnquiries } from "./reservations";
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
    templateId: z.string().max(50).optional(),
    includeVehicle: z.boolean(),
    includeAppointment: z.boolean(),
    photoIds: z.array(z.string()).max(6),
    documentIds: z.array(z.string()).max(3),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();
export async function communicationsPreview(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) {
  const own =
    [
      "/api/staff/notifications",
      "/api/staff/email-drafts",
      "/api/staff/email",
      "/api/staff/push",
      "/api/staff/ai-drafts/config",
    ].includes(url.pathname) ||
    url.pathname.startsWith('/api/staff/push/') ||
    /^\/api\/staff\/enquiries\/[^/]+\/ai-draft$/.test(url.pathname) ||
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
  if (url.pathname === '/api/staff/ai-drafts/config' || /^\/api\/staff\/enquiries\/[^/]+\/ai-draft$/.test(url.pathname)) {
    // A file-backed preview must never use a real provider key or customer data.
    const reason = 'AI drafting needs the authenticated backend and an operator-enabled dealership. Local preview never contacts OpenAI.';
    if (req.method === 'GET' && url.pathname === '/api/staff/ai-drafts/config') {
      send(200, { enabled: false, available: false, reason, model: 'gpt-6-luna', dailyLimit: 20, monthlyLimit: 500, dailyUsed: 0, monthlyUsed: 0 });
    } else {
      send(503, { error: reason });
    }
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
    const enquiries = await readPreviewEnquiries();
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
          add("followups", "Follow-up due", e.followUpAt);
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
    if (req.method === "GET" && url.pathname.endsWith("/email-context")) {
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
        defaults: {
          subject: `Your enquiry · ${entry.reference}`,
          message: `Hello ${entry.customerName},\n\nThank you for your enquiry. How can we help?`,
        },
        ready: false,
        templates: [],
        invoices: [],
        photos: [],
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
        if (!parsed.success) {
          send(400, { error: "Check the draft." });
          return true;
        }
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
        send(200, {
          to: body.to,
          subject: body.subject,
          text: body.message,
          previewHash: "0".repeat(64),
          attachments: [],
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
