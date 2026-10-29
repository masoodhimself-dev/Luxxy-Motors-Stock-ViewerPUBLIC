import { Router, type Response } from 'express';
import { pool } from '@workspace/db';
import { z } from 'zod/v4';
import { currentDealerId } from './tenant-context';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';

type Row = Record<string, any>;
type Client = { query: (text: string, values?: any[]) => Promise<{ rows: Row[] }>; release: () => void };
type Database = { connect: () => Promise<Client> };
export type EnquiryDeletionAssessment = { id: string; expectedRevision: number; canDelete: boolean; reason: string | null };
const revisionSchema = z.number().int().min(0);
const idSchema = z.string().uuid();
const deletionSchema = z.object({ expectedRevision: revisionSchema, confirmDelete: z.literal(true) }).strict();

export class EnquiryDeletionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function hasDocumentReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasDocumentReference);
  return Object.entries(value).some(([key, entry]) => {
    if (key === 'kind' && typeof entry === 'string' && ['online_reservation', 'online_stripe_reservation', 'online_reservation_cancelled', 'stripe_reservation_activity'].includes(entry)) return true;
    if (/(?:document|invoice|receipt|payment|sale)Ids?$/i.test(key) && entry != null && entry !== '' && (!Array.isArray(entry) || entry.length > 0)) return true;
    if ((key === 'templateId' || key === 'confirmationScope') && typeof entry === 'string' && /invoice|receipt|sale|payment/i.test(entry)) return true;
    if (key === 'contentType' && entry === 'application/pdf') return true;
    return hasDocumentReference(entry);
  });
}

/** Locks and checks the selected enquiry only; names and contact details are never ownership links. */
async function assess(client: Client, dealer: string, id: string) {
  const entry = (await client.query('SELECT * FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealer, id])).rows[0];
  if (!entry) throw new EnquiryDeletionError('Enquiry not found.', 404);
  const result = (reason: string | null, shares: Row[] = []) => ({ entry, shares, view: { id, expectedRevision: entry.workspace_revision, canDelete: reason === null, reason } satisfies EnquiryDeletionAssessment });
  if (entry.merged_into_id || entry.merged_at || entry.merged_by || (await client.query('SELECT id FROM enquiries WHERE merged_into_id=$1::uuid LIMIT 1', [id])).rows.length) return result('Merged customer records are protected.');
  // Modern communication FKs include dealer_id. Still fail closed for legacy
  // inconsistent rows and non-FK capabilities before any cascade or detachment.
  const childTables = ['enquiry_emails', 'enquiry_email_drafts', 'enquiry_email_replies', 'enquiry_email_reply_routes', 'email_outbox', 'enquiry_photos', 'enquiry_photo_upload_sessions', 'customer_email_preparations', 'test_drive_declarations', 'stock_change_customer_outcomes', 'stock_change_contact_events', 'staff_push_deliveries', 'vehicle_watch_reply_routes', 'staff_ai_draft_generations'];
  const children = (await client.query(childTables.map(table => `SELECT dealer_id FROM ${table} WHERE enquiry_id=$1::uuid`).join(' UNION ALL '), [id])).rows;
  if (children.some(child => child.dealer_id !== dealer)) return result('This enquiry has an inconsistent dealership link and is protected.');
  if (entry.appointment_at && !entry.appointment_cancelled_at && entry.attendance === 'scheduled') return result('Cancel or complete the test-drive appointment before deleting this enquiry.');
  // Both sales implementations are retained. Any financial or reserved link blocks deletion.
  if ((await client.query('SELECT id FROM sales WHERE enquiry_id=$1::uuid LIMIT 1', [id])).rows.length || (await client.query("SELECT id FROM sale_workspace WHERE dealer_id=$1 AND state::text LIKE '%'||$2||'%' LIMIT 1", [dealer, id])).rows.length) return result('This enquiry is linked to a sale, invoice, payment or reservation and is protected.');
  const leads = (await client.query('SELECT * FROM leads WHERE enquiry_id=$1::uuid ORDER BY id FOR UPDATE', [id])).rows;
  for (const lead of leads) {
    if (lead.dealer_id !== dealer || lead.deposit_pence || lead.deposit_method || lead.deposit_taken_at || lead.deposit_reference || ['reserved', 'sale_agreed', 'collected', 'won'].includes(lead.stage)) return result('A linked customer lead, reservation or deposit is protected.');
    if ((await client.query('SELECT id FROM sales WHERE lead_id=$1::uuid LIMIT 1', [lead.id])).rows.length || (await client.query("SELECT id FROM sale_workspace WHERE dealer_id=$1 AND state::text LIKE '%'||$2||'%' LIMIT 1", [dealer, lead.id])).rows.length) return result('A linked sale, invoice or payment is protected.');
    const history = (await client.query('SELECT type,payload FROM lead_events WHERE lead_id=$1::uuid FOR UPDATE', [lead.id])).rows;
    if (history.some(event => event.type === 'deposit_recorded' || event.type === 'sale_created' || hasDocumentReference(event.payload))) return result('A linked lead has financial or reservation history and is protected.');
  }
  if ((await client.query('SELECT id FROM sold_vehicle_follow_ups WHERE enquiry_id=$1::uuid OR related_enquiry_ids ? $2 LIMIT 1', [id, id])).rows.length) return result('This enquiry is linked to a completed sale follow-up and is protected.');
  if ((await client.query('SELECT id FROM test_drive_declarations WHERE enquiry_id=$1::uuid AND signed_at IS NOT NULL LIMIT 1', [id])).rows.length) return result('A signed test-drive declaration is linked to this enquiry and is protected.');
  const events = (await client.query('SELECT dealer_id,detail FROM enquiry_events WHERE enquiry_id=$1::uuid FOR UPDATE', [id])).rows;
  if (events.some(event => event.dealer_id !== dealer)) return result('This enquiry has an inconsistent dealership link and is protected.');
  if (events.some(event => hasDocumentReference(event.detail))) return result('This enquiry includes invoice, payment or sale documents and is protected.');
  const drafts = (await client.query('SELECT status,content FROM enquiry_email_drafts WHERE enquiry_id=$1::uuid FOR UPDATE', [id])).rows;
  if (drafts.some(draft => ['sending', 'unknown'].includes(draft.status))) return result('An email is being sent or awaiting a delivery result. Resolve it before deleting this enquiry.');
  if (drafts.some(draft => hasDocumentReference(draft.content))) return result('This enquiry has a financial document attachment and is protected.');
  const emails = (await client.query('SELECT status,document_ids FROM enquiry_emails WHERE enquiry_id=$1::uuid FOR UPDATE', [id])).rows;
  if (emails.some(email => ['sending', 'unknown'].includes(email.status))) return result('An email is being sent or awaiting a delivery result. Resolve it before deleting this enquiry.');
  if (emails.some(email => Array.isArray(email.document_ids) && email.document_ids.length)) return result('This enquiry includes invoice or payment emails and is protected.');
  const outbox = (await client.query('SELECT status FROM email_outbox WHERE enquiry_id=$1::uuid FOR UPDATE', [id])).rows;
  if (outbox.some(item => ['queued', 'sending', 'unknown'].includes(item.status))) return result('An email is queued or awaiting a delivery result. Resolve it before deleting this enquiry.');
  const replies = (await client.query('SELECT status FROM enquiry_email_replies WHERE enquiry_id=$1::uuid FOR UPDATE', [id])).rows;
  if (replies.some(reply => ['pending', 'processing'].includes(reply.status))) return result('A customer reply is still processing. Try again once it appears in the conversation.');
  // Share payloads have no FK. Revoke every selected-enquiry grant atomically to remove old QR access.
  const shares = (await client.query("SELECT id,dealer_id,payload FROM customer_phone_shares WHERE payload->>'enquiryId'=$2 OR (dealer_id=$1 AND payload::text LIKE '%'||$2||'%') ORDER BY id FOR UPDATE", [dealer, id])).rows;
  if (shares.some(share => share.dealer_id !== dealer || hasDocumentReference(share.payload))) return result('A financial document or inconsistent shared customer link is protected.');
  if ((await client.query("SELECT id FROM staff_push_deliveries WHERE enquiry_id=$1::uuid AND status='sending' LIMIT 1 FOR UPDATE", [id])).rows.length) return result('A staff notification is being processed. Try again shortly.');
  return result(null, shares);
}

export class EnquiryDeletionStore {
  constructor(private database: Database = pool, private options: { clock?: () => Date } = {}) {}
  private now() { return this.options.clock?.() ?? new Date(); }
  private async transaction<T>(dealer: string, work: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      // Same order as the existing sale and merge writers.
      for (const prefix of ['sale-workspace', 'enquiry-merge']) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${prefix}:${dealer}`]);
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async inspect(dealer: string, id: string) {
    return this.transaction(dealer, async client => (await assess(client, dealer, id)).view);
  }
  async remove(dealer: string, id: string, expectedRevision: number, actor: string, confirmDelete: boolean) {
    if (confirmDelete !== true || !revisionSchema.safeParse(expectedRevision).success || !actor) throw new EnquiryDeletionError('Review the enquiry and confirm permanent deletion of it and its conversation.', 400);
    return this.transaction(dealer, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`enquiry-email:${dealer}:${id}`]);
      const assessed = await assess(client, dealer, id);
      if (assessed.view.expectedRevision !== expectedRevision) throw new EnquiryDeletionError('This enquiry changed. Refresh and review it before deleting.', 409);
      if (!assessed.view.canDelete) throw new EnquiryDeletionError(assessed.view.reason!, 409);
      const now = this.now();
      for (const share of assessed.shares) await client.query("UPDATE customer_phone_shares SET revoked_at=coalesce(revoked_at,$3),payload='{}'::jsonb WHERE dealer_id=$1 AND id=$2::uuid", [dealer, share.id, now]);
      await client.query("UPDATE staff_push_deliveries SET status='cancelled',lease_until=NULL,finished_at=coalesce(finished_at,$3),enquiry_id=NULL WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND status='pending'", [dealer, id, now]);
      await client.query('UPDATE staff_push_deliveries SET enquiry_id=NULL WHERE dealer_id=$1 AND enquiry_id=$2::uuid', [dealer, id]);
      await client.query('UPDATE vehicle_watch_reply_routes SET enquiry_id=NULL WHERE dealer_id=$1 AND enquiry_id=$2::uuid', [dealer, id]);
      // Accounting for AI usage survives; discard generated customer text without changing usage totals.
      await client.query("UPDATE staff_ai_draft_generations SET result=NULL WHERE dealer_id=$1 AND enquiry_id=$2::uuid", [dealer, id]);
      // FK cascades remove only this enquiry's conversation, drafts, reply capabilities and photos.
      // Leads are deliberately retained by their ON DELETE SET NULL link; customers are untouched.
      await client.query('DELETE FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid', [dealer, id]);
      return { deleted: true as const, id };
    });
  }
}

function respondError(res: Response, error: unknown) {
  if (error instanceof EnquiryDeletionError) res.status(error.status).json({ error: error.message });
  else res.status(503).json({ error: 'Unable to complete this action. Refresh and try again.' });
}
export function enquiryDeletionRouter(store = new EnquiryDeletionStore()) {
  const router = Router();
  const deletionPath = '/staff/enquiries/:id/deletion';
  router.use(deletionPath, requireStaff, requirePermission('sales.manage'), (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get(deletionPath, async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) { res.status(400).json({ error: 'Choose a valid enquiry.' }); return; }
    try { res.json(await store.inspect(currentDealerId(), String(req.params.id))); }
    catch (error) { req.log.error('Unable to check enquiry deletion'); respondError(res, error); }
  });
  router.delete(deletionPath, async (req, res) => {
    const parsed = deletionSchema.safeParse(req.body);
    if (!idSchema.safeParse(req.params.id).success || !parsed.success) { res.status(400).json({ error: 'Review the enquiry and confirm permanent deletion of it and its conversation.' }); return; }
    try {
      const dealer = currentDealerId(), id = String(req.params.id), actor = req.staff!.authUserId;
      const result = await store.remove(dealer, id, parsed.data.expectedRevision, actor, parsed.data.confirmDelete);
      req.log.info({ dealerId: dealer, enquiryId: id, authUserId: actor }, 'Enquiry permanently deleted');
      res.json(result);
    } catch (error) { req.log.error('Unable to delete enquiry'); respondError(res, error); }
  });
  return router;
}
