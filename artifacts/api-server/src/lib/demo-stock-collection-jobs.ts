import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import type { AutoTraderDealer } from './demo-link-stock';

export type CollectionJob = {
  id: string;
  requested_by: string;
  source_url: string;
  retailer_id: string;
  status: 'collecting' | 'ready' | 'failed';
  expires_at: Date;
  claim_token: string | null;
  lease_until: Date | null;
  payload_hash: string | null;
  dealer_id: string | null;
  dealer_name: string | null;
  received: number | null;
  error: string | null;
};

type CollectionReceipt = { dealerId: string; dealerName: string; received: number };
const collectionTimeout = 'The stock collection timed out. Try again or upload a complete JSON export.';
export const collectionFailed = 'Grok could not collect complete stock for this retailer. Check the connection or upload a complete JSON export.';

export function publicCollectionJob(job: CollectionJob) {
  if (job.status === 'ready' && job.dealer_id && job.dealer_name && job.received !== null) {
    return {
      status: 'ready' as const,
      dealerId: job.dealer_id,
      dealerName: job.dealer_name,
      previewPath: `/platform/preview/${job.dealer_id}`,
      received: job.received,
    };
  }
  if (job.status === 'failed') return { status: 'failed' as const, error: job.error ?? collectionFailed };
  if (job.status === 'ready') return { status: 'failed' as const, error: 'This private demo is no longer available.' };
  if (job.expires_at.getTime() <= Date.now() && (!job.lease_until || job.lease_until.getTime() <= Date.now())) {
    return { status: 'failed' as const, error: collectionTimeout };
  }
  return { jobId: job.id, status: 'collecting' as const };
}

export async function startDemoStockCollection(dealer: AutoTraderDealer, adminId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`demo-stock-collection:${dealer.retailerId}`]);
    const { rows: [prior] } = await client.query<CollectionJob>(
      `SELECT * FROM demo_stock_collection_jobs
        WHERE retailer_id = $1 AND status = 'collecting' AND (expires_at > now() OR lease_until > now())
        ORDER BY created_at DESC LIMIT 1`,
      [dealer.retailerId],
    );
    if (prior) {
      await client.query('COMMIT');
      return { job: prior, created: false };
    }
    const { rows: [job] } = await client.query<CollectionJob>(
      `INSERT INTO demo_stock_collection_jobs (requested_by, source_url, retailer_id, expires_at)
        VALUES ($1, $2, $3, now() + interval '10 minutes') RETURNING *`,
      [adminId, dealer.sourceUrl, dealer.retailerId],
    );
    await client.query('COMMIT');
    return { job, created: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function readDemoStockCollection(id: string) {
  const { rows: [job] } = await pool.query<CollectionJob>('SELECT * FROM demo_stock_collection_jobs WHERE id = $1', [id]);
  return job;
}

export async function rejectDemoStockCollection(id: string) {
  const result = await pool.query(
    `UPDATE demo_stock_collection_jobs SET status = 'failed', error = $2
      WHERE id = $1 AND status = 'collecting' AND payload_hash IS NULL`,
    [id, collectionFailed],
  );
  return result.rowCount === 1;
}

export async function claimDemoStockCollection(id: string, hash: string) {
  const token = randomUUID();
  // Bind the first complete snapshot even if its import must be retried.
  const result = await pool.query(
    `UPDATE demo_stock_collection_jobs
        SET payload_hash = $2, claim_token = $3, lease_until = now() + interval '90 seconds'
      WHERE id = $1 AND status = 'collecting' AND expires_at > now()
        AND (payload_hash IS NULL OR payload_hash = $2) AND (lease_until IS NULL OR lease_until <= now())
      RETURNING id`,
    [id, hash, token],
  );
  return result.rowCount === 1 ? token : null;
}

export async function finishDemoStockCollection(id: string, token: string, receipt?: CollectionReceipt, error?: string) {
  const { rows: [job] } = await pool.query<CollectionJob>(
    `UPDATE demo_stock_collection_jobs
        SET status = $3, claim_token = NULL, lease_until = NULL, dealer_id = $4, dealer_name = $5, received = $6, error = $7
      WHERE id = $1 AND claim_token = $2 AND status = 'collecting'
      RETURNING *`,
    [id, token, receipt ? 'ready' : error ? 'failed' : 'collecting', receipt?.dealerId ?? null,
      receipt?.dealerName ?? null, receipt?.received ?? null, error ?? null],
  );
  return job;
}
