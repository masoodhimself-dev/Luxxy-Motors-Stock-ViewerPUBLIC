import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { currentDealerId, currentTenant } from "../lib/tenant-context";
import { siteOrigin } from "../lib/enquiry-links";
import { enquiryCaseIds } from "../lib/enquiry-case-ids";
import { readEmailDraft } from "../lib/email-drafts";
import { draftSchema } from "./enquiry-emails";
import { aiDraftFeature, checkAiGenerationForSave, checkSavedAiDraftFresh, AiDraftError } from '../lib/ai-drafts';

const editableDraft = draftSchema.extend({
  to: z.union([
    z.literal(""),
    z.string().trim().toLowerCase().max(254).email(),
  ]),
});
// Incomplete text is useful in a saved draft; the existing preview/send contract stays strict.
const saveSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    aiGenerationId: z.string().uuid().optional(),
    content: editableDraft.extend({
      subject: z
        .string()
        .max(200)
        .refine((v) => !/[\r\n\u0000-\u001f\u007f]/.test(v)),
      message: z
        .string()
        .max(12000)
        .refine(
          (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),
        ),
    }),
  })
  .strict();
const versionSchema = z
  .object({ expectedVersion: z.number().int().positive() })
  .strict();

export function createStaffNotificationsRouter() {
  const router = Router();
  router.use(
    [
      "/staff/notifications",
      "/staff/email-drafts",
      "/staff/enquiries/:id/email-draft",
    ],
    requireStaff,
    (req, res, next) => {
      res.set("Cache-Control", "no-store, private");
      const raw = req.get("origin");
      let valid = !raw;
      try {
        const origin = new URL(raw || siteOrigin()),
          canonical = new URL(siteOrigin());
        valid =
          (!raw || origin.origin === raw) &&
          !origin.username &&
          !origin.password &&
          (origin.origin === canonical.origin ||
            (currentTenant()?.kind === "website" &&
              origin.host === req.get("host") &&
              origin.protocol === canonical.protocol));
      } catch {
        valid = false;
      }
      if (!valid) {
        res
          .status(403)
          .json({ error: "Open the workspace on your dealership website." });
        return;
      }
      next();
    },
  );
  router.use(
    ["/staff/email-drafts", "/staff/enquiries/:id/email-draft"],
    requirePermission("sales.manage"),
  );

  router.get("/staff/notifications", async (req, res) => {
    try {
      const dealer = currentDealerId(),
        emailAccess = req.staff!.permissions?.includes("sales.manage") ?? false;
      // Actionable work, not "read receipts": opening an item never completes an enquiry.
      const rows = await db.execute(sql`WITH tasks AS (
        SELECT 'enquiries' AS category,e.id::text AS id,e.customer_name AS customer,e.vehicle_title AS vehicle,e.reference,e.created_at AS at,'Awaiting a reply' AS detail FROM enquiries e WHERE e.dealer_id=${dealer} AND e.merged_into_id IS NULL AND NOT EXISTS (SELECT 1 FROM enquiry_email_replies r WHERE r.dealer_id=e.dealer_id AND r.enquiry_id=e.id AND r.resolved_at IS NULL) AND e.status='new' AND e.call_outcome IS NULL AND NOT EXISTS (SELECT 1 FROM enquiry_emails sent WHERE sent.dealer_id=e.dealer_id AND sent.enquiry_id=e.id AND sent.status='sent')
        UNION ALL SELECT CASE WHEN bool_or(r.status<>'received') THEN 'email' ELSE 'enquiries' END,e.id::text,e.customer_name,e.vehicle_title,e.reference,min(r.received_at),CASE WHEN bool_or(r.status<>'received') THEN 'Incoming reply needs review' ELSE 'Customer replied — reply needed' END FROM enquiry_email_replies r JOIN enquiries e ON e.id=r.enquiry_id AND e.dealer_id=r.dealer_id WHERE r.dealer_id=${dealer} AND ${emailAccess} AND r.resolved_at IS NULL GROUP BY e.id
        UNION ALL SELECT 'followups',e.id::text,e.customer_name,e.vehicle_title,e.reference,e.follow_up_at,'Follow-up due' FROM enquiries e WHERE e.dealer_id=${dealer} AND e.merged_into_id IS NULL AND e.status<>'closed' AND e.follow_up_at<=now() AND e.follow_up_completed_at IS NULL
        UNION ALL SELECT 'appointments',e.id::text,e.customer_name,e.vehicle_title,e.reference,e.appointment_at,CASE WHEN e.appointment_status='pending' THEN 'Booking needs approval' ELSE 'Appointment today' END FROM enquiries e WHERE e.dealer_id=${dealer} AND e.merged_into_id IS NULL AND e.status<>'closed' AND e.appointment_cancelled_at IS NULL AND e.attendance='scheduled' AND ((e.appointment_status='pending' AND e.appointment_at>=now()) OR (e.appointment_at AT TIME ZONE 'Europe/London')::date=(now() AT TIME ZONE 'Europe/London')::date)
        UNION ALL SELECT 'drafts',e.id::text,e.customer_name,e.vehicle_title,e.reference,d.updated_at,CASE WHEN d.status='draft' THEN 'Draft ready to continue' WHEN d.status='sending' THEN 'Sending — check before resending' ELSE 'Email acceptance unconfirmed' END FROM enquiry_email_drafts d JOIN enquiries e ON e.id=d.enquiry_id AND e.dealer_id=d.dealer_id WHERE d.dealer_id=${dealer} AND ${emailAccess} AND d.status IN ('draft','sending','unknown') AND e.merged_into_id IS NULL
        UNION ALL SELECT 'email',e.id::text,e.customer_name,e.vehicle_title,e.reference,m.created_at,CASE WHEN coalesce(c.last_event,m.status)='bounced' THEN 'Email bounced' WHEN coalesce(c.last_event,m.status)='complained' THEN 'Email reported as spam' WHEN coalesce(c.last_event,m.status)='unknown' THEN 'Email acceptance unconfirmed' ELSE 'Email needs attention' END FROM enquiries e JOIN LATERAL (SELECT * FROM enquiry_emails x WHERE x.dealer_id=e.dealer_id AND x.enquiry_id=e.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) m ON true LEFT JOIN email_delivery_checks c ON c.dealer_id=e.dealer_id AND c.message_key='enquiry:'||m.id::text AND c.provider_id=m.provider_id WHERE e.dealer_id=${dealer} AND ${emailAccess} AND e.merged_into_id IS NULL AND coalesce(c.last_event,m.status) IN ('failed','unknown','bounced','complained','suppressed')
        UNION ALL SELECT 'email',e.id::text||':'||n.kind,e.customer_name,e.vehicle_title,e.reference,n.attempted_at,'Automated customer email needs attention' FROM enquiries e CROSS JOIN LATERAL (VALUES ('confirmation',e.customer_notification_status,e.customer_notification_attempted_at),('reminder',e.reminder_status,e.reminder_attempted_at)) n(kind,status,attempted_at) WHERE e.dealer_id=${dealer} AND ${emailAccess} AND e.merged_into_id IS NULL AND n.status IN ('failed','unknown') AND n.attempted_at IS NOT NULL
      ), ranked AS (SELECT *,count(*) OVER (PARTITION BY category)::int AS total,row_number() OVER (PARTITION BY category ORDER BY at,id) AS position FROM tasks)
      SELECT ranked.*,e.id AS "enquiryId",e.phone,left(e.message,240) AS preview FROM ranked LEFT JOIN enquiries e ON e.dealer_id=${dealer} AND e.id::text=split_part(ranked.id,':',1) WHERE position<=8 ORDER BY category,at,ranked.id`);
      const counts: Record<string, number> = {
        enquiries: 0,
        followups: 0,
        appointments: 0,
        drafts: 0,
        email: 0,
      };
      const items = rows.rows.map((row) => {
        counts[String(row.category)] = Number(row.total);
        const category = String(row.category),
          enquiryId = String(row.id).split(":")[0];
        const href = String(row.detail).startsWith("Customer replied") || String(row.detail).startsWith("Incoming reply")
          ? `/portal?section=notifications&workView=email&enquiryId=${enquiryId}` :
          category === "drafts"
            ? `/portal?section=email&draft=${enquiryId}`
            : category === "email"
              ? `/portal?section=email&customer=${encodeURIComponent(String(row.reference))}`
              : `/portal?section=enquiries&enquiryId=${enquiryId}`;
        return { ...row, href };
      });
      res.json({
        generatedAt: new Date().toISOString(),
        counts,
        items,
        capabilities: {
          aiDrafts: emailAccess && aiDraftFeature().available,
          automaticDrafts: false,
          automaticSending: false,
        },
        emailAccess,
      });
    } catch {
      res
        .status(503)
        .json({ error: "Notifications could not be loaded. Please refresh." });
    }
  });

  router.get("/staff/email-drafts", async (req, res) => {
    const input = z.object({ enquiryId: z.string().uuid().optional() }).safeParse(req.query);
    if (!input.success) { res.status(400).json({ error: 'Check the customer enquiry.' }); return; }
    try {
      const dealer = currentDealerId();
      const ids = input.data.enquiryId ? await enquiryCaseIds(dealer, input.data.enquiryId) : null;
      const scope = ids === null ? sql`` : ids.length ? sql`AND d.enquiry_id IN (${sql.join(ids.map(id => sql`${id}::uuid`), sql`, `)})` : sql`AND false`;
      const rows = await db.execute(
        sql`SELECT d.enquiry_id AS "enquiryId",d.version,d.status,d.source,d.updated_at AS "updatedAt",d.content->>'subject' AS subject,e.customer_name AS "customerName",e.vehicle_title AS "vehicleTitle",e.reference FROM enquiry_email_drafts d JOIN enquiries e ON e.id=d.enquiry_id AND e.dealer_id=d.dealer_id WHERE d.dealer_id=${dealer} AND d.status IN ('draft','sending','unknown') AND e.merged_into_id IS NULL ${scope} ORDER BY d.updated_at DESC,d.enquiry_id LIMIT 101`,
      );
      res.json({
        drafts: rows.rows.slice(0, 100),
        hasMore: rows.rows.length > 100,
      });
    } catch {
      res.status(503).json({ error: "Saved drafts could not be loaded." });
    }
  });
  router.post("/staff/enquiries/:id/email-draft", async (req, res) => {
    const id = String(req.params.id),
      input = saveSchema.safeParse(req.body);
    if (!z.string().uuid().safeParse(id).success || !input.success) {
      res
        .status(400)
        .json({ error: "Check the draft fields and refresh before saving." });
      return;
    }
    try {
      const dealer = currentDealerId();
      const result = await db.transaction(async (tx) => {
        const entry = (
          await tx.execute(
            sql`SELECT workspace_revision,merged_into_id FROM enquiries WHERE id=${id}::uuid AND dealer_id=${dealer} FOR UPDATE`,
          )
        ).rows[0];
        if (!entry || entry.merged_into_id)
          return {
            status: 404,
            error: "Enquiry not found or merged. Open the current enquiry.",
          };
        const saved = await readEmailDraft(
          dealer,
          id,
          tx as unknown as typeof db,
        );
        if (
          saved.version !== input.data.expectedVersion ||
          (saved.savedDraft && saved.savedDraft.status !== "draft")
        )
          return {
            status: 409,
            error:
              "This draft changed or has an unresolved send. Reopen it and check email history before continuing.",
          };
        // The UI must refresh facts rather than silently rebasing an old draft.
        if (
          Number(entry.workspace_revision) !==
          input.data.content.expectedRevision
        )
          return {
            status: 409,
            error:
              "The enquiry changed. Reopen the draft and review the latest details.",
          };
        const content = input.data.content;
        if (input.data.aiGenerationId && content.templateId) return { status: 400, error: 'Use the AI suggestion or a template, then review before saving.' };
        if (input.data.aiGenerationId) await checkAiGenerationForSave(tx, dealer, id, input.data.aiGenerationId, req.staff!.authUserId, content.expectedRevision, saved.version);
        const source = input.data.aiGenerationId ? 'ai' : content.templateId ? 'template' : saved.savedDraft?.source === 'ai' ? 'ai' : 'manual';
        if (source === 'ai' && !input.data.aiGenerationId) await checkSavedAiDraftFresh(tx, dealer, id, saved);
        const aiGenerationId = input.data.aiGenerationId ?? (source === 'ai' ? saved.savedDraft?.aiGenerationId : null);
        await tx.execute(
          sql`INSERT INTO enquiry_email_drafts(dealer_id,enquiry_id,version,status,source,content,updated_by,ai_generation_id) VALUES(${dealer},${id}::uuid,${saved.version + 1},'draft',${source},${JSON.stringify(content)}::jsonb,${req.staff!.authUserId},${aiGenerationId ?? null}::uuid) ON CONFLICT(dealer_id,enquiry_id) DO UPDATE SET version=excluded.version,status='draft',source=excluded.source,content=excluded.content,updated_by=excluded.updated_by,updated_at=now(),ai_generation_id=excluded.ai_generation_id,send_request_id=NULL`,
        );
        return {
          status: 200,
          ...(await readEmailDraft(dealer, id, tx as unknown as typeof db)),
        };
      });
      res.status(result.status).json(result);
    } catch (error) {
      if (error instanceof AiDraftError) { res.status(error.status).json({ error: error.message }); return; }
      res
        .status(503)
        .json({
          error: "Draft could not be saved. Your text is still on screen.",
        });
    }
  });
  router.post("/staff/enquiries/:id/email-draft/discard", async (req, res) => {
    const input = versionSchema.safeParse(req.body),
      id = String(req.params.id);
    if (!input.success || !z.string().uuid().safeParse(id).success) {
      res.status(400).json({ error: "Check the draft version." });
      return;
    }
    try {
      const rows = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM enquiries WHERE dealer_id=${currentDealerId()} AND id=${id}::uuid FOR UPDATE`,
        );
        return tx.execute(
          sql`UPDATE enquiry_email_drafts SET status='discarded',version=version+1,updated_at=now(),updated_by=${req.staff!.authUserId},content='{}'::jsonb WHERE dealer_id=${currentDealerId()} AND enquiry_id=${id}::uuid AND version=${input.data.expectedVersion} AND status='draft' RETURNING version`,
        );
      });
      if (!rows.rows.length) {
        res
          .status(409)
          .json({
            error:
              "Draft changed or has an unresolved send. Refresh before discarding.",
          });
        return;
      }
      res.json({ discarded: true });
    } catch {
      res.status(503).json({ error: "Draft could not be discarded." });
    }
  });
  return router;
}
export default createStaffNotificationsRouter();
