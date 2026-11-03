import { pool } from '@workspace/db';
import { assessEnquiryDeletion, EnquiryDeletionError, EnquiryDeletionStore, type EnquiryDeletionClient } from './enquiry-deletion';
import { z } from 'zod/v4';

type Database = { connect(): Promise<EnquiryDeletionClient>; query(text: string, values?: any[]): Promise<{ rows: Record<string, any>[] }> };
export const enquiryArchiveDays = 30;
export const archiveEnquiryInput = z.object({ expectedRevision: z.number().int().min(0) }).strict();
export class EnquiryArchiveStore {
  constructor(private database: Database = pool, private clock = () => new Date()) {}
  async change(dealer: string, id: string, expectedRevision: number, archive: boolean) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new EnquiryDeletionError('Refresh this enquiry before continuing.', 400);
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      for (const key of [`sale-workspace:${dealer}`, `enquiry-merge:${dealer}`, `enquiry-email:${dealer}:${id}`]) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const assessed = await assessEnquiryDeletion(client, dealer, id), entry = assessed.entry;
      if (Number(entry.workspace_revision) !== expectedRevision) throw new EnquiryDeletionError('This enquiry changed. Refresh and try again.', 409);
      // A shared case is not a single enquiry. Never hide appointments or sibling conversations implicitly.
      if (entry.merged_into_id || entry.merged_at || entry.merged_by || (await client.query('SELECT id FROM enquiries WHERE dealer_id=$1 AND merged_into_id=$2::uuid LIMIT 1', [dealer, id])).rows.length) throw new EnquiryDeletionError('Merged customer records must stay together. Open the main case; archiving a shared case is not available.', 409);
      if (archive) {
        if (entry.appointment_at && !entry.appointment_cancelled_at && ['scheduled', 'arrived'].includes(entry.attendance)) throw new EnquiryDeletionError('Cancel or complete the test-drive appointment before archiving this enquiry.', 409);
        // The enquiry row and email advisory lock serialize archive against send preparation.
        // Outbox delivery takes the enquiry row before claiming a queued delivery.
        const busy = (await client.query("SELECT status FROM email_outbox WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND status IN ('queued','sending','unknown') UNION ALL SELECT status FROM enquiry_emails WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND status IN ('sending','unknown') UNION ALL SELECT status FROM enquiry_email_drafts WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND status IN ('sending','unknown') UNION ALL SELECT status FROM enquiry_email_replies WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND status IN ('pending','processing')", [dealer, id])).rows;
        if (busy.length || [entry.customer_notification_status, entry.dealer_notification_status, entry.reminder_status].some(status => ['sending', 'unknown'].includes(status))) throw new EnquiryDeletionError('A message is queued or being processed. Let it finish before archiving this enquiry.', 409);
      }
      const now = this.clock();
      const row = (await client.query(archive
        ? 'UPDATE enquiries SET archived_at=coalesce(archived_at,$3),archive_delete_at=coalesce(archive_delete_at,$4),archive_review_at=coalesce(archive_review_at,$4),archive_hold_reason=$5,workspace_revision=workspace_revision+1,updated_at=$3 WHERE dealer_id=$1 AND id=$2::uuid RETURNING *'
        : 'UPDATE enquiries SET archived_at=NULL,archive_delete_at=NULL,archive_review_at=NULL,archive_hold_reason=NULL,workspace_revision=workspace_revision+1,updated_at=$3 WHERE dealer_id=$1 AND id=$2::uuid RETURNING *',
      archive ? [dealer, id, now, new Date(now.getTime() + enquiryArchiveDays * 86400000), assessed.view.reason] : [dealer, id, now])).rows[0];
      await client.query('COMMIT');
      return row;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
}

/** Classification comes from an actual automated receipt, never from the stock source or a manual draft. */
export async function enquiryAiStates(dealer: string, ids: string[], database: Pick<Database, 'query'> = pool) {
  if (!ids.length) return new Map<string, { aiProvider: 'cazoo'; aiDraftStatus: string }>();
  const rows = (await database.query("SELECT DISTINCT ON(enquiry_id) enquiry_id,draft_status FROM cazoo_lead_receipts WHERE dealer_id=$1 AND enquiry_id=ANY($2::uuid[]) AND status='imported' AND draft_status IN ('pending','generating','ready','failed') ORDER BY enquiry_id,received_at DESC,id DESC", [dealer, ids])).rows;
  return new Map(rows.map(row => [String(row.enquiry_id), { aiProvider: 'cazoo' as const, aiDraftStatus: String(row.draft_status) }]));
}

/** Bounded hourly cleanup; every due record is rechecked under the normal deletion protections. */
export async function purgeArchivedEnquiries(dealer: string, now = new Date(), database: Database = pool) {
  const rows = (await database.query('SELECT id FROM enquiries WHERE dealer_id=$1 AND archived_at IS NOT NULL AND archive_delete_at<=$2 AND coalesce(archive_review_at,archive_delete_at)<=$2 AND archived_at<=$3 ORDER BY coalesce(archive_review_at,archive_delete_at),id LIMIT 25', [dealer, now, new Date(now.getTime() - enquiryArchiveDays * 86400000)])).rows;
  const store = new EnquiryDeletionStore(database, { clock: () => now });
  const counts = { deleted: 0, held: 0 };
  for (const row of rows) {
    try {
      const result = await store.purgeArchived(dealer, String(row.id));
      if (result.deleted) counts.deleted++;
      if (result.held) counts.held++;
    } catch (error) {
      if (!(error instanceof EnquiryDeletionError && error.status === 404)) throw error;
    }
  }
  return counts;
}
