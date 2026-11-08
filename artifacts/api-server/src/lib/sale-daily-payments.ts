import {
  dailySalePaymentsPageSize, dailySalePaymentsResult,
  type DailySalePaymentGroup, type DailySalePaymentRow, type DailySalePaymentsOptions,
} from '@workspace/vehicle-meta';
import type { SaleWorkspaceReadClient } from './sale-workspace-store';

export async function readDailySalePayments(client: SaleWorkspaceReadClient, dealerId: string, options: DailySalePaymentsOptions) {
  const result = await client.query(`
    WITH payment_rows AS (
      SELECT p->>'id' AS id, s.id::text AS "saleId", s.reference AS "saleReference",
        coalesce(s.state#>>'{draft,vehicle}', '') AS vehicle,
        coalesce(s.state#>>'{draft,registration}', '') AS registration,
        coalesce(p->>'reference', '') AS reference,
        coalesce(nullif(p->>'method', ''), 'Unspecified') AS method,
        p->>'status' AS status, p->>'kind' AS kind,
        (p->>'signedAmountPence')::numeric AS "amountPence",
        p->>'recordedAt' AS recorded_at
      FROM sale_workspace AS s
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(s.state->'payments') = 'array' THEN s.state->'payments' ELSE '[]'::jsonb END
      ) AS p
      WHERE s.dealer_id = $1
        AND jsonb_typeof(p->'signedAmountPence') = 'number'
        AND ((p->>'status' = 'confirmed' AND p->>'date' = $2)
          OR (p->>'status' = 'pending' AND coalesce(nullif(p->>'expectedDate', ''), p->>'date') = $2))
    ),
    confirmed_page AS (
      SELECT * FROM payment_rows WHERE status = 'confirmed'
      ORDER BY recorded_at DESC NULLS LAST, "saleId", id LIMIT $3 OFFSET $4
    ),
    pending_page AS (
      SELECT * FROM payment_rows WHERE status = 'pending'
      ORDER BY recorded_at DESC NULLS LAST, "saleId", id LIMIT $3 OFFSET $5
    ),
    summary AS (
      SELECT status, kind, method, sum("amountPence") AS "amountPence", count(*) AS count
      FROM payment_rows GROUP BY status, kind, method
    )
    SELECT
      coalesce((SELECT jsonb_agg(to_jsonb(c) - 'status' - 'recorded_at' ORDER BY recorded_at DESC NULLS LAST, "saleId", id) FROM confirmed_page c), '[]'::jsonb) AS confirmed,
      coalesce((SELECT jsonb_agg(to_jsonb(p) - 'status' - 'recorded_at' ORDER BY recorded_at DESC NULLS LAST, "saleId", id) FROM pending_page p), '[]'::jsonb) AS pending,
      coalesce((SELECT jsonb_agg(to_jsonb(g)) FROM summary g), '[]'::jsonb) AS groups
  `, [dealerId, options.date, dailySalePaymentsPageSize, options.confirmedOffset, options.pendingOffset]);
  const row = result.rows[0] as { confirmed: DailySalePaymentRow[]; pending: DailySalePaymentRow[]; groups: DailySalePaymentGroup[] };
  return dailySalePaymentsResult(options, row.confirmed, row.pending, row.groups);
}
