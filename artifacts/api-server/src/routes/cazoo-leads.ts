import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireStaff, requirePermission } from "../middlewares/staff-auth";
import { enforceStaffWriteOrigin } from "../middlewares/staff-write-origin";
import { currentDealerId } from "../lib/tenant-context";
import { cazooDraftAutomationEligibility, cazooLeadMailboxes, cazooLeadsEnabled } from "../lib/cazoo-leads";
import { cazooTestSender } from "../lib/cazoo-owner-test";
export function createCazooLeadRouter() {
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
      const rows = await db.execute(
        sql`SELECT id,status,error_code AS "errorCode",subject,enquiry_id AS "enquiryId",draft_status AS "draftStatus",received_at AS "receivedAt",review_text AS "reviewText" FROM cazoo_lead_receipts WHERE dealer_id=${dealer} ORDER BY received_at DESC,id LIMIT 20`,
      );
      res.json({
        enabled:
          cazooLeadsEnabled() &&
          Boolean(process.env.CAZOO_LEADS_WEBHOOK_SECRET || process.env.RESEND_RECEIVING_WEBHOOK_SECRET),
        mailbox: cazooLeadMailboxes()[dealer] ?? null,
        ownerTest: cazooTestSender(dealer),
        automation: await cazooDraftAutomationEligibility(dealer),
        receipts: rows.rows.map((r) => ({
          ...r,
          receivedAt: new Date(String(r.receivedAt)).toISOString(),
        })),
      });
    } catch {
      res.status(503).json({ error: "Cazoo connection could not be loaded." });
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
