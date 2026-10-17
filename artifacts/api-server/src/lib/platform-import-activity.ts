import { sql } from 'drizzle-orm';
import type { db } from '@workspace/db';

// Only compact operational data leaves Postgres; no full snapshots or image URLs.
export async function importActivityDetails(database: Pick<typeof db, 'execute'>, dealerId: string, runId: string) {
  const result = await database.execute(sql`
    WITH target AS (
      SELECT * FROM stock_import_runs WHERE dealer_id = ${dealerId} AND run_id = ${runId}
    ), previous AS (
      SELECT r.* FROM stock_import_runs r, target t
      WHERE r.dealer_id = t.dealer_id AND r.source = t.source AND r.status = 'completed'
        AND r.received_at < t.received_at ORDER BY r.received_at DESC LIMIT 1
    ), changes AS (
      SELECT v.id, v.advert_id, v.title,
        bool_or(c.field_name = 'title' AND (c.old_value IS NULL OR c.old_value = 'null'::jsonb)) AS added,
        jsonb_agg(DISTINCT c.field_name) AS fields,
        max(CASE WHEN c.field_name = 'sourcePrice' THEN c.old_value::text END) AS old_price,
        max(CASE WHEN c.field_name = 'sourcePrice' THEN c.new_value::text END) AS new_price
      FROM vehicle_changes c JOIN target t ON t.id = c.import_run_id
      JOIN vehicles v ON v.id = c.vehicle_id AND v.dealer_id = t.dealer_id
      GROUP BY v.id, v.advert_id, v.title
    ), missing AS (
      SELECT car->>'advertId' AS advert_id, car->>'title' AS title
      FROM previous p CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(p.raw_snapshot->'cars') = 'array' THEN p.raw_snapshot->'cars' ELSE '[]'::jsonb END) car
      WHERE NOT EXISTS (
        SELECT 1 FROM target t CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(t.raw_snapshot->'cars') = 'array' THEN t.raw_snapshot->'cars' ELSE '[]'::jsonb END) incoming
        WHERE incoming->>'advertId' = car->>'advertId'
      )
    ) SELECT t.run_id, t.status,
      CASE WHEN t.status = 'completed' THEN greatest(0, extract(epoch FROM (t.updated_at - t.received_at)) * 1000) ELSE NULL END AS duration_ms,
      (SELECT count(*) FROM changes) AS change_count,
      coalesce((SELECT jsonb_agg(row_to_json(c)) FROM (SELECT * FROM changes ORDER BY added DESC, title, advert_id LIMIT 250) c), '[]'::jsonb) AS changes,
      CASE WHEN t.status <> 'completed' THEN '[]'::jsonb
        WHEN t.raw_snapshot_compacted_at IS NOT NULL OR t.raw_snapshot IS NULL
          OR EXISTS (SELECT 1 FROM previous p WHERE p.raw_snapshot_compacted_at IS NOT NULL OR p.raw_snapshot IS NULL) THEN NULL
        ELSE coalesce((SELECT jsonb_agg(row_to_json(m)) FROM (SELECT * FROM missing ORDER BY title, advert_id LIMIT 250) m), '[]'::jsonb) END AS newly_missing,
      (t.raw_snapshot_compacted_at IS NULL AND t.raw_snapshot IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM previous p WHERE p.raw_snapshot_compacted_at IS NOT NULL OR p.raw_snapshot IS NULL)) AS snapshot_details_available,
      (SELECT run_id FROM previous) AS previous_run_id
    FROM target t`);
  return result.rows[0] ?? null;
}
