import { replyConfiguration } from '../lib/customer-email-replies';
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { currentDealerId, currentTenant } from "../lib/tenant-context";
import { siteOrigin } from "../lib/enquiry-links";
import { enquiryCaseIds } from "../lib/enquiry-case-ids";
import {
  dealerIntegrationsStore,
  effectiveResendSettings,
  type ResendSettings,
} from "../lib/dealer-integrations-store";

const events = new Set([
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "opened",
  "clicked",
  "failed",
  "suppressed",
  "scheduled",
  "queued",
  "canceled",
]);
export function providerEmailStatus(value: unknown) {
  return typeof value === "string" && events.has(value) ? value : "unknown";
}
// Raw SQL timestamps use PostgreSQL's text format. Return ISO dates so browsers
// share one format and mixed enquiry/email timelines sort by the same instant.
function emailTimestamp(value: unknown) {
  if (value == null) return value;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
export function createStaffEmailRouter(
  transport: typeof fetch = fetch,
  settingsProvider: () => Promise<ResendSettings> = async () =>
    effectiveResendSettings(await dealerIntegrationsStore.readPrivate()),
) {
  const router = Router();
  router.use(
    "/staff/email",
    requireStaff,
    requirePermission("sales.manage"),
    (req, res, next) => {
      res.set({
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      });
      let allowed = !req.get("origin");
      try {
        const origin = new URL(req.get("origin") || siteOrigin()),
          canonical = new URL(siteOrigin());
        allowed =
          origin.origin === canonical.origin ||
          (currentTenant()?.kind === "website" &&
            origin.host === (req.get("host") || "") &&
            origin.protocol === canonical.protocol);
      } catch {}
      if (!allowed) {
        res
          .status(403)
          .json({ error: "Open email on your dealership website." });
        return;
      }
      next();
    },
  );
  async function find(key: string) {
    const dealer = currentDealerId();
    if (key.startsWith("reply:")) {
      const id=key.slice(6); if(!z.string().uuid().safeParse(id).success)return null;
      return (await db.execute(sql`SELECT m.id,NULL::text AS provider_id,r.recipient,m.sender,m.error_code,m.subject,m.message,(SELECT coalesce(jsonb_agg(jsonb_build_object('id',ordinality::text,'filename',value,'byteSize',0)),'[]'::jsonb) FROM jsonb_array_elements_text(m.attachment_names) WITH ORDINALITY) AS attachments,m.status,m.received_at AS created_at,m.enquiry_id,e.customer_name,e.reference,e.vehicle_id,e.vehicle_title,jsonb_array_length(m.attachment_names) AS attachment_count FROM enquiry_email_replies m JOIN enquiry_email_reply_routes r ON r.id=m.route_id AND r.dealer_id=m.dealer_id JOIN enquiries e ON e.id=m.enquiry_id AND e.dealer_id=m.dealer_id WHERE m.id=${id}::uuid AND m.dealer_id=${dealer}`)).rows[0] ?? null;
    }
    if (key.startsWith("enquiry:")) {
      const id = key.slice(8);
      if (!z.string().uuid().safeParse(id).success) return null;
      const rows = await db.execute(
        sql`SELECT m.id,m.provider_id,m.recipient,m.subject,coalesce(m.rendered_text,m.message) AS message,m.attachment_manifest AS attachments,m.status,m.created_at,e.id AS enquiry_id,e.customer_name,e.reference,e.vehicle_id,e.vehicle_title,CASE WHEN jsonb_array_length(m.attachment_manifest)>0 THEN jsonb_array_length(m.attachment_manifest) ELSE jsonb_array_length(m.photo_ids)+jsonb_array_length(m.document_ids) END AS attachment_count FROM enquiry_emails m JOIN enquiries e ON e.id=m.enquiry_id AND e.dealer_id=m.dealer_id WHERE m.id=${id}::uuid AND m.dealer_id=${dealer}`,
      );
      return rows.rows[0] ?? null;
    }
    const notification = /^(notification|reminder):([a-f0-9-]{36})$/i.exec(key);
    if (notification && z.string().uuid().safeParse(notification[2]).success) {
      const reminder = notification[1] === "reminder";
      const prefix = reminder ? "reminder" : "customer_notification";
      const rows = await db.execute(
        sql`SELECT id::text AS enquiry_id,customer_name,email AS recipient,reference,vehicle_id,vehicle_title,${sql.raw(prefix + "_provider_id")} AS provider_id,${sql.raw(prefix + "_status")} AS status,${sql.raw(prefix + "_attempted_at")} AS created_at FROM enquiries WHERE dealer_id=${dealer} AND id=${notification[2]}::uuid AND ${sql.raw(prefix + "_attempted_at")} IS NOT NULL`,
      );
      return rows.rows[0]
        ? {
            ...rows.rows[0],
            subject: reminder
              ? "Appointment reminder"
              : "Customer confirmation",
            message:
              "This is the latest automated email recorded for this enquiry. Open the enquiry to review the appointment details.",
            attachment_count: 0,
          }
        : null;
    }
    const match = /^sale:([a-f0-9-]{36}):([A-Za-z0-9_-]{8,100})$/i.exec(key);
    if (!match || !z.string().uuid().safeParse(match[1]).success) return null;
    const rows = await db.execute(
      sql`SELECT s.id AS sale_id,s.reference,s.state#>>'{draft,customer}' AS customer_name,s.state#>>'{draft,vehicleId}' AS vehicle_id,s.state#>>'{draft,vehicle}' AS vehicle_title,s.state#>>'{draft,sourceEnquiryId}' AS enquiry_id,d->>'providerId' AS provider_id,d->>'to' AS recipient,d->>'status' AS status,d->>'attemptedAt' AS created_at,d->>'documentId' AS document_id FROM sale_workspace s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.state->'emailDeliveries')='array' THEN s.state->'emailDeliveries' ELSE '[]'::jsonb END) d WHERE s.dealer_id=${dealer} AND s.id=${match[1]}::uuid AND d->>'id'=${match[2]}`,
    );
    return rows.rows[0]
      ? {
          ...rows.rows[0],
          subject: "Sales document",
          message: "The original saved document was attached to this email.",
          attachment_count: 1,
        }
      : null;
  }
  router.get("/staff/email", async (req, res) => {
    const input = z
      .object({
        q: z.string().max(200).default(""),
        offset: z.coerce.number().int().min(0).max(10000).default(0),
        enquiryId: z.string().uuid().optional(),
        saleId: z.string().uuid().optional(),
        includeBody: z.enum(["true", "false"]).default("false"),
      })
      .refine((value) => !(value.enquiryId && value.saleId))
      .refine((value) => value.includeBody !== "true" || Boolean(value.enquiryId || value.saleId))
      .safeParse(req.query);
    if (!input.success) {
      res.status(400).json({ error: "Check the email search." });
      return;
    }
    const dealer = currentDealerId(),
      term = `%${input.data.q}%`;
    const caseIds = input.data.enquiryId
      ? await enquiryCaseIds(dealer, input.data.enquiryId)
      : null;
    const caseFilter = caseIds === null
      ? sql``
      : caseIds.length
        ? sql`AND m.enquiry_id IN (${sql.join(caseIds.map((id) => sql`${id}`), sql`, `)})`
        : sql`AND false`;
    const saleFilter = input.data.saleId ? sql`AND m.sale_id=${input.data.saleId}` : sql``;
    const includeBody = input.data.includeBody === "true";
    const rows = await db.execute(sql`WITH messages AS (
    SELECT 'enquiry:'||m.id::text AS key,'enquiry' AS kind,m.created_at,e.customer_name,m.recipient,m.subject,m.status,m.provider_id,e.id::text AS enquiry_id,NULL::text AS sale_id,NULL::text AS document_id,e.vehicle_id::text AS vehicle_id,e.vehicle_title,e.reference,CASE WHEN jsonb_array_length(m.attachment_manifest)>0 THEN jsonb_array_length(m.attachment_manifest) ELSE jsonb_array_length(m.photo_ids)+jsonb_array_length(m.document_ids) END AS attachment_count,${includeBody ? sql`coalesce(m.rendered_text,m.message)` : sql`NULL::text`} AS message FROM enquiry_emails m JOIN enquiries e ON e.id=m.enquiry_id AND e.dealer_id=m.dealer_id WHERE m.dealer_id=${dealer}
    UNION ALL
    SELECT 'reply:'||m.id::text,'reply',m.received_at,e.customer_name,r.recipient,coalesce(m.subject,'Customer reply'),CASE WHEN m.resolved_at IS NOT NULL THEN 'handled' WHEN m.status='received' THEN 'reply_needed' ELSE 'review' END,NULL::text,e.id::text,NULL::text,NULL::text,e.vehicle_id::text,e.vehicle_title,e.reference,jsonb_array_length(m.attachment_names),${includeBody ? sql`coalesce(m.message,'Reply is awaiting retrieval. Please check again shortly.')` : sql`NULL::text`} FROM enquiry_email_replies m JOIN enquiry_email_reply_routes r ON r.id=m.route_id AND r.dealer_id=m.dealer_id JOIN enquiries e ON e.id=m.enquiry_id AND e.dealer_id=m.dealer_id WHERE m.dealer_id=${dealer}
    UNION ALL
    SELECT n.kind||':'||e.id::text,n.kind,n.attempted_at,e.customer_name,e.email,n.subject,n.status,n.provider_id,e.id::text,NULL::text,NULL::text,e.vehicle_id::text,e.vehicle_title,e.reference,0,${includeBody ? sql`'This is the latest automated email recorded for this enquiry. Open the enquiry to review the appointment details.'::text` : sql`NULL::text`} FROM enquiries e CROSS JOIN LATERAL (VALUES ('notification',e.customer_notification_attempted_at,'Customer confirmation'||CASE WHEN nullif(e.vehicle_title,'') IS NOT NULL THEN ' — '||e.vehicle_title ELSE '' END,e.customer_notification_status,e.customer_notification_provider_id),('reminder',e.reminder_attempted_at,'Appointment reminder'||CASE WHEN nullif(e.vehicle_title,'') IS NOT NULL THEN ' — '||e.vehicle_title ELSE '' END,e.reminder_status,e.reminder_provider_id)) n(kind,attempted_at,subject,status,provider_id) WHERE e.dealer_id=${dealer} AND n.attempted_at IS NOT NULL
    UNION ALL
    SELECT 'sale:'||s.id::text||':'||(d->>'id'),'sale',coalesce((d->>'attemptedAt')::timestamptz,s.updated_at),s.state#>>'{draft,customer}',d->>'to',coalesce(doc->>'title','Sales document')||' '||coalesce(doc->>'number',''),d->>'status',d->>'providerId',s.state#>>'{draft,sourceEnquiryId}',s.id::text,d->>'documentId',s.state#>>'{draft,vehicleId}',s.state#>>'{draft,vehicle}',s.reference,1,${includeBody ? sql`'The original saved document was attached to this email.'::text` : sql`NULL::text`} FROM sale_workspace s CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.state->'emailDeliveries')='array' THEN s.state->'emailDeliveries' ELSE '[]'::jsonb END) d LEFT JOIN LATERAL (SELECT doc FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.state->'documents')='array' THEN s.state->'documents' ELSE '[]'::jsonb END) doc WHERE doc->>'id'=d->>'documentId' LIMIT 1) details ON true WHERE s.dealer_id=${dealer}
   ) SELECT m.*,c.last_event,c.checked_at FROM messages m LEFT JOIN email_delivery_checks c ON c.dealer_id=${dealer} AND c.message_key=m.key AND c.provider_id=m.provider_id WHERE concat_ws(' ',m.customer_name,m.recipient,m.subject,m.vehicle_title,m.reference) ILIKE ${term} ${caseFilter} ${saleFilter} ORDER BY m.created_at DESC,m.key LIMIT 51 OFFSET ${input.data.offset}`);
    let replyTo: string | null = null;
    try {
      const settings = await settingsProvider();
      replyTo = settings.replyTo || settings.from || null;
    } catch {}
    res.json({
      replyTo,
      repliesConnected: Boolean(replyConfiguration()),
      messages: rows.rows.slice(0, 50).map((row) => {
        const normalized: Record<string, unknown> = { ...row, created_at: emailTimestamp(row.created_at), checked_at: emailTimestamp(row.checked_at) };
        if (includeBody) return normalized;
        const { message: _message, ...summary } = normalized;
        return summary;
      }),
      hasMore: rows.rows.length > 50,
    });
  });
  router.get('/staff/email/reply-attention',async(req,res)=>{
    const id=String(req.query.enquiryId||'');if(!z.string().uuid().safeParse(id).success){res.sendStatus(400);return;}
    const ids=await enquiryCaseIds(currentDealerId(),id);
    if(!ids.length){res.sendStatus(404);return;}
    const row=(await db.execute(sql`SELECT count(*)::int AS pending,count(*) FILTER(WHERE status<>'received')::int AS review FROM enquiry_email_replies WHERE dealer_id=${currentDealerId()} AND enquiry_id IN (${sql.join(ids.map(i=>sql`${i}::uuid`),sql`,`)}) AND resolved_at IS NULL`)).rows[0];
    res.json(row);
  });
  router.get("/staff/email/message/:key", async (req, res) => {
    const row = await find(String(req.params.key));
    if (!row) {
      res.status(404).json({ error: "Email not found." });
      return;
    }
    res.json({ message: row });
  });
  router.post('/staff/email/replies/:id/handled', async(req,res)=>{
    const id=String(req.params.id);if(!z.string().uuid().safeParse(id).success){res.sendStatus(400);return;}
    const rows=await db.execute(sql`UPDATE enquiry_email_replies SET resolved_at=now(),resolved_by=${req.staff!.authUserId} WHERE id=${id}::uuid AND dealer_id=${currentDealerId()} AND status IN ('received','review') RETURNING id`);
    if(!rows.rows.length){res.sendStatus(404);return;}res.json({handled:true});
  });
  router.post("/staff/email/message/:key/status", async (req, res) => {
    const key = String(req.params.key),
      row = await find(key);
    if (!row) {
      res.status(404).json({ error: "Email not found." });
      return;
    }
    if (key.startsWith("reply:")) { res.status(400).json({error:"Incoming replies do not have outgoing delivery status."});return; }
    if (!row.provider_id) {
      res.status(409).json({
        error:
          "Provider acceptance was not confirmed. Check the delivery history before sending another copy.",
      });
      return;
    }
    if (!z.string().uuid().safeParse(row.provider_id).success) {
      res.status(409).json({
        error: "This historical delivery cannot be checked automatically.",
      });
      return;
    }
    const dealer = currentDealerId();
    const cached = (
      await db.execute(
        sql`SELECT last_event,checked_at FROM email_delivery_checks WHERE dealer_id=${dealer} AND message_key=${key} AND provider_id=${String(row.provider_id)}`,
      )
    ).rows[0];
    if (
      cached &&
      Date.now() - new Date(String(cached.checked_at)).getTime() < 60000
    ) {
      res.json({
        event: cached.last_event,
        checkedAt: cached.checked_at,
        cached: true,
      });
      return;
    }
    const settings = await settingsProvider();
    if (!settings.enabled || !settings.apiKey) {
      res
        .status(409)
        .json({ error: "Enable the dealership’s Resend connection first." });
      return;
    }
    try {
      const response = await transport(
        `https://api.resend.com/emails/${row.provider_id}`,
        {
          headers: { Authorization: `Bearer ${settings.apiKey}` },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      if (!response.ok) {
        res.status(response.status === 429 ? 429 : 503).json({
          error:
            response.status === 403 || response.status === 401
              ? "The Resend key needs permission to retrieve sent emails. Sending-only keys cannot check delivery."
              : response.status === 404
                ? "Resend no longer has this email available for checking."
                : "Delivery status is temporarily unavailable. The saved email is unchanged.",
        });
        return;
      }
      const data = (await response.json()) as {
        id?: string;
        to?: string[];
        last_event?: string;
      };
      if (
        data.id !== row.provider_id ||
        !Array.isArray(data.to) ||
        !data.to.some(
          (to) => to.toLowerCase() === String(row.recipient).toLowerCase(),
        )
      )
        throw new Error("Provider mismatch");
      const event = providerEmailStatus(data.last_event);
      if (event === "unknown") {
        res.status(503).json({
          error:
            "Resend returned an unrecognised status. The previous status is retained.",
        });
        return;
      }
      const checkedAt = new Date();
      await db.execute(
        sql`INSERT INTO email_delivery_checks(dealer_id,message_key,provider_id,last_event,checked_at) VALUES(${dealer},${key},${String(row.provider_id)},${event},${checkedAt}) ON CONFLICT(dealer_id,message_key) DO UPDATE SET provider_id=excluded.provider_id,last_event=excluded.last_event,checked_at=excluded.checked_at`,
      );
      res.json({ event, checkedAt: checkedAt.toISOString(), cached: false });
    } catch {
      res.status(503).json({
        error: "Delivery status could not be verified. No email was resent.",
      });
    }
  });
  router.use(
    "/staff/email",
    (_error: unknown, req: Request, res: Response, _next: NextFunction) => {
      req.log?.warn("Email workspace request failed");
      if (!res.headersSent)
        res
          .status(503)
          .json({
            error:
              "Email workspace is temporarily unavailable. Saved emails have not changed.",
          });
    },
  );
  return router;
}
export default createStaffEmailRouter();
