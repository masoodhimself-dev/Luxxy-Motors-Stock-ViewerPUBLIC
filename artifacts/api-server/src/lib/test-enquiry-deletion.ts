import { Router } from 'express';
import { pool } from '@workspace/db';
import { z } from 'zod/v4';
import { currentDealerId } from './tenant-context';
import { requirePermission, requireStaff } from '../middlewares/staff-auth';

type Row = Record<string, any>;
type Client = { query: (text: string, values?: any[]) => Promise<{ rows: Row[] }>; release: () => void };
type Database = { connect: () => Promise<Client> };
export type TestEnquiryDeletion = { id: string; expectedRevision: number; canDelete: boolean; reason: string | null };
const idSchema = z.string().uuid();
const deleteSchema = z.object({ expectedRevision: z.number().int().min(0), confirmTestOnly: z.literal(true) }).strict();

/** Deliberately excludes "test drive", "contest", suffixes and a customer merely discussing a test. */
export function explicitlyTestLabelled(value: unknown): boolean {
  return typeof value === 'string' && /^(?:\[TEST\](?:\s|$)|TEST(?:$|\s*[:\-–—]\s*|\s+))(?!drive\b)/i.test(value.trim());
}
const lower = (value: unknown) => String(value ?? '').trim().toLowerCase();
const phone = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(-10);
export class TestEnquiryDeletionError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function safeEvent(event: Row) {
  if (event.kind === 'enquiry_received') return true;
  if (event.kind !== 'conversation_logged' || event.actor !== 'dealer') return false;
  const detail = event.detail ?? {};
  if (!explicitlyTestLabelled(detail.message ?? detail.note)) return false;
  if (detail.direction === 'inbound' || detail.replyId || detail.emailId || detail.saleId || detail.documentId || detail.paymentId) return false;
  return !Array.isArray(detail.attachmentNames) || detail.attachmentNames.every((name: unknown) => typeof name === 'string' && /\.(?:jpe?g|png)$/i.test(name));
}

function safeShare(share: Row, entry: Row) {
  const payload = share.payload ?? {};
  if (payload.enquiryId !== entry.id || payload.confirmationScope || !explicitlyTestLabelled(payload.customerName) || lower(payload.customerName) !== lower(entry.customer_name)) return false;
  if (!explicitlyTestLabelled(payload.messageBody ?? payload.message)) return false;
  if (payload.customerEmail && lower(payload.customerEmail) !== lower(entry.email) || payload.customerPhone && phone(payload.customerPhone) !== phone(entry.phone)) return false;
  if (['invoice', 'receipt'].includes(payload.templateId)) return false;
  return Array.isArray(payload.files) && payload.files.every((file: Row) => ['image/jpeg', 'image/png'].includes(file.contentType));
}

/** The caller holds the enquiry row lock; all checks are repeated immediately before deletion. */
async function assess(client: Client, dealer: string, id: string): Promise<{ view: TestEnquiryDeletion; entry: Row; leads: Row[]; shares: Row[] }> {
  const entry = (await client.query('SELECT * FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid FOR UPDATE', [dealer, id])).rows[0];
  if (!entry) throw new TestEnquiryDeletionError('Enquiry not found.', 404);
  const result = (reason: string | null, leads: Row[] = [], shares: Row[] = []) => ({ entry, leads, shares, view: { id, expectedRevision: entry.workspace_revision, canDelete: reason === null, reason } });
  const generatedWhatsApp = entry.source === 'whatsapp' && entry.message === 'Staff-created enquiry for a WhatsApp conversation.';
  if (!explicitlyTestLabelled(entry.customer_name) || !explicitlyTestLabelled(entry.message) && !generatedWhatsApp) return result('Only enquiries clearly labelled TEST in the customer name and original message can be deleted.');
  if (!['phone', 'phone_ad_hoc', 'whatsapp', 'walk_in', 'walk-in', 'test', 'website'].includes(entry.source)) return result('Marketplace and unrecognised enquiry sources are protected.');
  if (entry.merged_into_id || entry.merged_at || entry.merged_by || (await client.query('SELECT id FROM enquiries WHERE merged_into_id=$1::uuid LIMIT 1', [id])).rows.length) return result('Merged customer records are protected.');
  if (entry.type === 'viewing' || entry.appointment_at || entry.appointment_cancelled_at || entry.appointment_status || entry.appointment_revision || entry.manage_token_hash || entry.attendance !== 'scheduled') return result('Enquiries with current or previous appointments are protected.');
  if (entry.visitor_id || entry.follow_up_at || entry.follow_up_completed_at || entry.follow_up_revision) return result('Enquiries with customer activity or follow-up history are protected.');
  if (entry.staff_note && !explicitlyTestLabelled(entry.staff_note) || entry.follow_up_note && !explicitlyTestLabelled(entry.follow_up_note)) return result('This enquiry contains staff notes that are not clearly labelled as test data.');
  if (entry.customer_notification_status !== 'not_sent' || entry.dealer_notification_status !== 'not_sent' || entry.reminder_status !== 'not_scheduled' || entry.customer_notification_sent_at || entry.customer_notification_provider_id || entry.dealer_notification_sent_at || entry.dealer_notification_provider_id || entry.reminder_sent_at || entry.reminder_provider_id) return result('Enquiries with email delivery or notification history are protected.');
  // Contact details are not ownership links. A staff test may deliberately use
  // the operator's own number; other enquiries/customers are never updated here.
  if ((await client.query("SELECT id FROM sale_workspace WHERE dealer_id=$1 AND (state-'documentArchives'-'providerPayments'-'requests')::text LIKE '%'||$2||'%' LIMIT 1", [dealer, id])).rows.length) return result('This enquiry is connected to a saved sale, invoice or payment record and cannot be deleted.');
  if ((await client.query('SELECT id FROM sales WHERE enquiry_id=$1::uuid LIMIT 1', [id])).rows.length) return result('This enquiry is connected to a sale and cannot be deleted.');
  const protectedRows = (await client.query(`SELECT EXISTS(SELECT 1 FROM enquiry_emails WHERE enquiry_id=$1::uuid) OR EXISTS(SELECT 1 FROM email_outbox WHERE enquiry_id=$1::uuid) OR EXISTS(SELECT 1 FROM enquiry_email_reply_routes WHERE enquiry_id=$1::uuid) OR EXISTS(SELECT 1 FROM enquiry_email_replies WHERE enquiry_id=$1::uuid) OR EXISTS(SELECT 1 FROM test_drive_declarations WHERE enquiry_id=$1::uuid) OR EXISTS(SELECT 1 FROM sold_vehicle_follow_ups WHERE enquiry_id=$1::uuid OR related_enquiry_ids ? $2) AS protected`, [id, id])).rows[0];
  if (protectedRows?.protected) return result('Enquiries with emails, customer replies, declarations or sale follow-ups are protected.');
  const drafts = (await client.query('SELECT status,send_request_id,content FROM enquiry_email_drafts WHERE enquiry_id=$1::uuid', [id])).rows;
  if (drafts.some(draft => !['draft', 'discarded'].includes(draft.status) || draft.send_request_id || draft.content?.documentIds?.length)) return result('This enquiry has an invoice attachment or attempted email send and cannot be deleted.');
  const events = (await client.query('SELECT dealer_id,kind,actor,detail FROM enquiry_events WHERE enquiry_id=$1::uuid FOR UPDATE', [id])).rows;
  if (events.some(event => event.dealer_id !== dealer || !safeEvent(event))) return result('This enquiry contains customer messages or activity that is not clearly labelled as a staff test.');
  if (generatedWhatsApp && !events.some(event => event.kind === 'conversation_logged' && event.actor === 'dealer' && explicitlyTestLabelled(event.detail?.message))) return result('This WhatsApp enquiry has no clearly labelled staff test message.');
  const leads = (await client.query('SELECT * FROM leads WHERE enquiry_id=$1::uuid ORDER BY id FOR UPDATE', [id])).rows;
  if (leads.some(lead => lead.dealer_id !== dealer || lead.enquiry_id !== id || !explicitlyTestLabelled(lead.customer_name) || lead.stage !== 'new' || lead.deposit_pence || lead.deposit_method || lead.deposit_taken_at || lead.deposit_reference || lead.outcome || lead.last_contacted_at)) return result('A linked customer lead, reservation or deposit is protected.');
  for (const lead of leads) {
    const history = (await client.query('SELECT type,payload FROM lead_events WHERE lead_id=$1::uuid FOR UPDATE', [lead.id])).rows;
    if (history.some(event => !['lead_created', 'enquiry_received'].includes(event.type) || Object.keys(event.payload ?? {}).some(key => !['enquiryId', 'enquiryType', 'enquirySource', 'vehicleId'].includes(key)))) return result('This enquiry has progressed lead or financial history and cannot be deleted.');
    if ((await client.query('SELECT id FROM sales WHERE lead_id=$1::uuid LIMIT 1', [lead.id])).rows.length) return result('A sale is linked to this lead and is protected.');
    if ((await client.query("SELECT id FROM sale_workspace WHERE dealer_id=$1 AND (state-'documentArchives'-'providerPayments'-'requests')::text LIKE '%'||$2||'%' LIMIT 1", [dealer, lead.id])).rows.length) return result('A saved sale or document is linked to this lead and is protected.');
  }
  const shares = (await client.query("SELECT id,dealer_id,payload FROM customer_phone_shares WHERE payload->>'enquiryId'=$2 OR (dealer_id=$1 AND payload::text LIKE '%'||$2||'%') ORDER BY id FOR UPDATE", [dealer, id])).rows;
  if (shares.some(share => share.dealer_id !== dealer || !safeShare(share, entry))) return result('A shared message or document is not clearly a test-only link. It is protected.');
  return result(null, leads, shares);
}

export class TestEnquiryDeletionStore {
  constructor(private database: Database = pool) {}
  private async transaction<T>(dealer: string, work: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      // Match the existing dealer locks. Sale/source checks and share preparation
      // cannot race this cleanup, and merge membership stays stable throughout.
      for (const prefix of ['sale-workspace', 'phone-shares', 'enquiry-merge']) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${prefix}:${dealer}`]);
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async inspect(dealer: string, id: string) {
    return this.transaction(dealer, async client => (await assess(client, dealer, id)).view);
  }
  async remove(dealer: string, id: string, expectedRevision: number) {
    return this.transaction(dealer, async client => {
      const assessed = await assess(client, dealer, id);
      if (assessed.view.expectedRevision !== expectedRevision) throw new TestEnquiryDeletionError('This enquiry changed. Refresh and review it before deleting.', 409);
      if (!assessed.view.canDelete) throw new TestEnquiryDeletionError(assessed.view.reason!, 409);
      for (const share of assessed.shares) await client.query("UPDATE customer_phone_shares SET revoked_at=coalesce(revoked_at,now()),payload='{}'::jsonb WHERE dealer_id=$1 AND id=$2::uuid", [dealer, share.id]);
      for (const lead of assessed.leads) await client.query('DELETE FROM leads WHERE dealer_id=$1 AND id=$2::uuid AND enquiry_id=$3::uuid', [dealer, lead.id, id]);
      // These notifications contain no customer content and must not stay due on Home.
      await client.query("UPDATE staff_push_deliveries SET status='cancelled',lease_until=NULL,finished_at=coalesce(finished_at,now()) WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND status='pending'", [dealer, id]);
      await client.query('DELETE FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid', [dealer, id]);
      // Spend reservations deliberately survive enquiry deletion; do not erase AI usage.
      return { deleted: true as const, id };
    });
  }
}

export function testEnquiryDeletionRouter(store = new TestEnquiryDeletionStore()) {
  const router = Router();
  router.use('/staff/enquiries/:id/deletion', requireStaff, requirePermission('sales.manage'), (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/staff/enquiries/:id/deletion', async (req, res) => {
    if (!idSchema.safeParse(req.params.id).success) { res.status(400).json({ error: 'Choose a valid enquiry.' }); return; }
    try { res.json(await store.inspect(currentDealerId(), String(req.params.id))); }
    catch (error) { req.log.error({ err: error }, 'Unable to check test enquiry deletion'); res.status(error instanceof TestEnquiryDeletionError ? error.status : 503).json({ error: error instanceof TestEnquiryDeletionError ? error.message : 'Unable to check this enquiry. Try again.' }); }
  });
  router.delete('/staff/enquiries/:id/deletion', async (req, res) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!idSchema.safeParse(req.params.id).success || !parsed.success) { res.status(400).json({ error: 'Review the test enquiry and confirm test-only deletion.' }); return; }
    try { res.json(await store.remove(currentDealerId(), String(req.params.id), parsed.data.expectedRevision)); }
    catch (error) { req.log.error({ err: error }, 'Unable to delete test enquiry'); res.status(error instanceof TestEnquiryDeletionError ? error.status : 503).json({ error: error instanceof TestEnquiryDeletionError ? error.message : 'The test enquiry could not be deleted. Refresh and try again.' }); }
  });
  return router;
}
