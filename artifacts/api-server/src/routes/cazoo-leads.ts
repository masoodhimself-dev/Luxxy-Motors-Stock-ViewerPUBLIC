import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { enforceStaffWriteOrigin } from "../middlewares/staff-write-origin";
import { currentDealerId, currentTenant } from "../lib/tenant-context";
import { roleHasPermission } from "../lib/staff-permissions";
import { replyConfiguration, retrieveReply } from "../lib/customer-email-replies";
import { cazooDraftAutomationEligibility, cazooLeadMailboxes, cazooLeadsEnabled } from "../lib/cazoo-leads";
import { cazooTestSender } from "../lib/cazoo-owner-test";
import { cazooFirstReplyActor } from "../lib/cazoo-automatic-first-reply";
import { cazooLeadForwardRecipient, queueCazooLeadForward } from "../lib/cazoo-lead-forwarding";

const forwardingInput = z.object({
  enabled: z.boolean(),
  recipient: z.string().trim().max(254).nullable(),
  forwardReplies: z.boolean().optional(),
}).strict();
const nonLeadErrors = new Set([
  "owner_test", "owner_test_format", "sender_not_cazoo", "sender_authentication_unverified",
  "recipient_mismatch", "mailbox_not_connected", "retrieval_failed",
]);
type ForwardableReceipt = { status: string; errorCode?: string | null; reviewText?: string | null };
function canForwardReceipt(receipt: ForwardableReceipt) {
  return !nonLeadErrors.has(receipt.errorCode ?? "") &&
    (receipt.status === "imported" || (receipt.status === "review" && Boolean(receipt.reviewText)));
}

async function readForwarding(dealer: string, canManage: boolean) {
  const row = (await db.execute(sql`SELECT enabled,recipient,forward_replies FROM cazoo_lead_forwarding_settings WHERE dealer_id=${dealer}`)).rows[0];
  return {
    enabled: row?.enabled === true,
    forwardReplies: canManage && row?.forward_replies === true,
    recipient: canManage && typeof row?.recipient === "string" ? row.recipient : null,
    canManage,
  };
}

export function createCazooLeadRouter(retrieve = retrieveReply) {
  const router = Router();
  router.use(
    "/staff/cazoo-leads",
    requireStaff,
    requirePermission("sales.manage"),
    (_req, res, next) => {
      res.set("Cache-Control", "no-store, private");
      next();
    },
  );
  router.get("/staff/cazoo-leads", async (_req, res) => {
    try {
      const dealer = currentDealerId();
      const canManage = !currentTenant()?.demo && roleHasPermission(_req.staff?.role, "integrations.manage");
      const forwarding = await readForwarding(dealer, canManage);
      const rows = await db.execute(
        sql`SELECT r.id,r.status,r.error_code AS "errorCode",r.subject,r.enquiry_id AS "enquiryId",r.draft_status AS "draftStatus",r.received_at AS "receivedAt",r.review_text AS "reviewText",
          (SELECT e.status FROM enquiry_emails e WHERE e.dealer_id=r.dealer_id AND e.enquiry_id=r.enquiry_id AND e.request_id=r.id AND e.created_by=${cazooFirstReplyActor}) AS "automaticReplyStatus",
          f.status AS "forwardStatus"
          FROM cazoo_lead_receipts r LEFT JOIN cazoo_lead_forwards f ON f.dealer_id=r.dealer_id AND f.receipt_id=r.id
          WHERE r.dealer_id=${dealer} ORDER BY r.received_at DESC,r.id LIMIT 20`,
      );
      res.json({
        enabled:
          cazooLeadsEnabled() &&
          Boolean(process.env.CAZOO_LEADS_WEBHOOK_SECRET || process.env.RESEND_RECEIVING_WEBHOOK_SECRET),
        mailbox: cazooLeadMailboxes()[dealer] ?? null,
        ownerTest: cazooTestSender(dealer),
        automation: await cazooDraftAutomationEligibility(dealer),
        forwarding,
        receipts: rows.rows.map((r) => ({
          ...r,
          receivedAt: new Date(String(r.receivedAt)).toISOString(),
          canForward: canManage && forwarding.enabled && !r.forwardStatus &&
            canForwardReceipt({status: String(r.status), errorCode: r.errorCode as string | null, reviewText: r.reviewText as string | null}),
        })),
      });
    } catch {
      res.status(503).json({ error: "Cazoo connection could not be loaded." });
    }
  });
  router.put("/staff/cazoo-leads/forwarding", requirePermission("integrations.manage"), async (req, res) => {
    if (!enforceStaffWriteOrigin(req, res)) return;
    const input = forwardingInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: "Check the forwarding settings." });
      return;
    }
    const dealer = currentDealerId();
    const mailboxes = cazooLeadMailboxes();
    const recipient = cazooLeadForwardRecipient(input.data.recipient, Object.values(mailboxes));
    const replyDomain = replyConfiguration(dealer)?.domain;
    if ((input.data.recipient !== null && !recipient) || (input.data.enabled && !recipient) ||
      (recipient && replyDomain && recipient.endsWith(`@${replyDomain}`))) {
      res.status(400).json({ error: "Enter a valid owner email address different from the Cazoo delivery address." });
      return;
    }
    if (input.data.enabled && (!cazooLeadsEnabled() || !mailboxes[dealer])) {
      res.status(409).json({ error: "Connect the Cazoo mailbox before enabling forwarding." });
      return;
    }
    if (input.data.forwardReplies && (!input.data.enabled || !replyDomain)) {
      res.status(409).json({ error: "Connect customer reply routing and enable enquiry forwarding first." });
      return;
    }
    try {
      const forwardReplies = input.data.enabled ? input.data.forwardReplies ?? null : false;
      const saved = await db.execute(sql`
        INSERT INTO cazoo_lead_forwarding_settings(dealer_id,recipient,enabled,forward_replies,updated_by)
        SELECT d.id,${recipient},${input.data.enabled},COALESCE(${forwardReplies}::boolean,false),${req.staff!.authUserId}
        FROM dealerships d WHERE d.id=${dealer} AND d.status='active' AND d.stock_platform='cazoo'
          AND NOT EXISTS(SELECT 1 FROM dealer_demos m WHERE m.dealer_id=d.id AND m.converted_at IS NULL)
        ON CONFLICT(dealer_id) DO UPDATE SET recipient=excluded.recipient,enabled=excluded.enabled,
          forward_replies=COALESCE(${forwardReplies}::boolean,cazoo_lead_forwarding_settings.forward_replies),
          updated_by=excluded.updated_by,updated_at=now()
        RETURNING dealer_id`);
      if (!saved.rows.length) {
        res.status(409).json({ error: "Forwarding is available for active Cazoo dealerships." });
        return;
      }
      res.json(await readForwarding(dealer, true));
    } catch {
      res.status(503).json({ error: "Forwarding settings could not be saved. Try again." });
    }
  });
  router.post("/staff/cazoo-leads/:id/forward", requirePermission("integrations.manage"), async (req, res) => {
    if (!enforceStaffWriteOrigin(req, res)) return;
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) { res.sendStatus(400); return; }
    try {
      const dealer = currentDealerId();
      const activeMailbox = cazooLeadMailboxes()[dealer];
      if (!cazooLeadsEnabled() || !activeMailbox || !(await readForwarding(dealer, true)).enabled) {
        res.status(409).json({ error: "Enable forwarding and connect the Cazoo mailbox first." });
        return;
      }
      const row = (await db.execute(sql`
        SELECT provider_id,mailbox,status,error_code AS "errorCode",review_text AS "reviewText"
        FROM cazoo_lead_receipts WHERE id=${id.data}::uuid AND dealer_id=${dealer}
          AND received_at>=now()-interval '30 days'`)).rows[0];
      if (!row || row.mailbox !== activeMailbox ||
          !canForwardReceipt({status: String(row.status), errorCode: row.errorCode as string | null, reviewText: row.reviewText as string | null})) {
        res.status(404).json({ error: "This Cazoo lead is unavailable for forwarding." });
        return;
      }
      const providerId = String(row.provider_id);
      const email = await retrieve(providerId);
      const outcome = await queueCazooLeadForward({
        id: id.data, dealer_id: dealer, provider_id: providerId, mailbox: activeMailbox,
      }, email);
      if (outcome === "not_eligible") {
        res.status(409).json({ error: "The original email could not be verified as an eligible Cazoo lead." });
        return;
      }
      res.json({ queued: true, alreadyQueued: outcome === "already_queued" });
    } catch {
      res.status(503).json({ error: "The Cazoo lead could not be queued for forwarding. Try again." });
    }
  });
  router.post("/staff/cazoo-leads/:id/retry", async (req, res) => {
    if (!enforceStaffWriteOrigin(req, res)) return;
    const id = String(req.params.id);
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)) {
      res.sendStatus(400);
      return;
    }
    try {
      const dealer = currentDealerId();
      if (!cazooLeadsEnabled() || !cazooLeadMailboxes()[dealer]) {
        res.status(409).json({ error: "Connect the Cazoo mailbox first." });
        return;
      }
      const rows = await db.execute(
        sql`UPDATE cazoo_lead_receipts SET status='pending',attempts=0,error_code=NULL,next_attempt_at=now(),lease_until=NULL WHERE id=${id}::uuid AND dealer_id=${dealer} AND status='review' RETURNING id`,
      );
      res
        .status(rows.rows.length ? 200 : 404)
        .json({ queued: Boolean(rows.rows.length) });
    } catch {
      res
        .status(503)
        .json({ error: "Cazoo email could not be queued. Try again." });
    }
  });
  return router;
}
export default createCazooLeadRouter();
