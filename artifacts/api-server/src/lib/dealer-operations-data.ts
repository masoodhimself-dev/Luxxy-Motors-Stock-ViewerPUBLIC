import type { dealerOperationsSummary } from "./dealer-operations";

type Summary = ReturnType<typeof dealerOperationsSummary>;
export type OperationsData = Omit<Summary, "stock" | "generatedAt">;
type ReadDatabase = {
  query: (
    text: string,
    parameters: unknown[],
  ) => Promise<{ rows: Record<string, any>[] }>;
};

// Mirror saleWorkspacePence: blank is zero; malformed/unsafe money is invalid,
// never silently credited. Expressions below are static SQL, not user input.
const pence = (expression: string) => `CASE
  WHEN coalesce(btrim(${expression}), '') = '' THEN 0::numeric
  WHEN length(btrim(${expression})) <= 18 AND btrim(${expression}) ~ '^[0-9]+([.][0-9]{1,2})?$'
    THEN CASE WHEN (${expression})::numeric * 100 <= 9007199254740991 THEN (${expression})::numeric * 100 ELSE NULL END
  ELSE NULL END`;
const sumMoney = (expression: string) =>
  `CASE WHEN count(*) FILTER (WHERE (${expression}) IS NULL) > 0 THEN NULL ELSE coalesce(sum(${expression}), 0) END`;
const price = pence("a.draft->>'price'");
const allowance = pence("x->>'value'");
const adjustment = pence("x->>'amount'");
const signedPayment = `CASE WHEN x->>'signedAmountPence' ~ '^-?[0-9]+$' THEN CASE WHEN abs((x->>'signedAmountPence')::numeric) <= 9007199254740991 THEN (x->>'signedAmountPence')::numeric ELSE NULL END ELSE NULL END`;

/** Compute one compact dealer summary in PostgreSQL. No sale documents, archive
 * bytes, customer messages or raw import snapshots leave the database. */
export async function readDealerOperationsData(
  database: ReadDatabase,
  dealerId: string,
  now: Date,
  missingThreshold: number,
): Promise<OperationsData> {
  const result = await database.query(
    `WITH
  dealer_enquiries AS MATERIALIZED (
    SELECT id, status, appointment_at, appointment_cancelled_at, appointment_status,
      follow_up_at, follow_up_completed_at, customer_name, vehicle_title
    FROM enquiries WHERE dealer_id = $1
  ),
  active_sales AS MATERIALIZED (
    SELECT id, reference, updated_at, state->'draft' AS draft, coalesce(state->'payments', '[]'::jsonb) AS payments,
      (coalesce(state#>>'{lifecycle,status}', '') = 'sold' OR coalesce(state#>>'{draft,handover}', 'false') = 'true') AS sold
    FROM sale_workspace WHERE dealer_id = $1 AND coalesce(state#>>'{lifecycle,status}', '') <> 'released'
  ),
  money_sales AS MATERIALIZED (
    SELECT a.*, ${price} - allowances.amount + adjustments.amount - paid.amount AS balance_pence
    FROM active_sales a
    CROSS JOIN LATERAL (
      SELECT ${sumMoney(allowance)} AS amount FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(a.draft->'exchanges') = 'array' THEN a.draft->'exchanges'
          WHEN a.draft->>'partExchange' = 'true' THEN jsonb_build_array(jsonb_build_object('value', a.draft->>'pxValue'))
          ELSE '[]'::jsonb END) x
    ) allowances
    CROSS JOIN LATERAL (
      SELECT ${sumMoney(`(${adjustment}) * CASE WHEN x->>'kind' = 'discount' THEN -1 ELSE 1 END`)} AS amount
      FROM jsonb_array_elements(coalesce(nullif(a.draft->'adjustments', 'null'::jsonb), '[]'::jsonb)) x
    ) adjustments
    CROSS JOIN LATERAL (
      SELECT ${sumMoney(signedPayment)} AS amount FROM jsonb_array_elements(a.payments) x WHERE x->>'status' = 'confirmed'
    ) paid
  ),
  upcoming AS MATERIALIZED (
    SELECT * FROM dealer_enquiries WHERE appointment_at >= $2::timestamptz AND appointment_cancelled_at IS NULL
  ),
  deliveries AS MATERIALIZED (
    SELECT * FROM active_sales WHERE draft#>>'{fulfilment,method}' = 'delivery'
      AND coalesce(draft#>>'{fulfilment,completedAt}', '') = ''
      AND coalesce(draft->>'handover', 'false') <> 'true'
  ),
  conversions AS (
    SELECT count(DISTINCT e.id)::int AS converted, count(DISTINCT e.id) FILTER (WHERE a.sold)::int AS sold
    FROM dealer_enquiries e JOIN active_sales a ON a.draft->>'sourceEnquiryId' = e.id::text
  )
  SELECT jsonb_build_object(
    'unansweredEnquiries', (SELECT count(*)::int FROM dealer_enquiries WHERE status = 'new'),
    'upcomingAppointments', (SELECT count(*)::int FROM upcoming),
    'pendingAppointments', (SELECT count(*)::int FROM upcoming WHERE appointment_status = 'pending'),
    'overdueFollowUps', (SELECT count(*)::int FROM dealer_enquiries WHERE status <> 'closed' AND follow_up_at < $2::timestamptz AND follow_up_completed_at IS NULL),
    'outstandingBalancePence', (SELECT coalesce(sum(balance_pence), 0) FROM money_sales WHERE balance_pence > 0),
    'salesWithBalance', (SELECT count(*)::int FROM money_sales WHERE balance_pence > 0),
    'upcomingDeliveries', (SELECT count(*)::int FROM deliveries),
    'totalEnquiries', (SELECT count(*)::int FROM dealer_enquiries),
    'convertedEnquiries', (SELECT converted FROM conversions),
    'soldEnquiries', (SELECT sold FROM conversions),
    'enquiryConversionPercent', coalesce(round((SELECT converted FROM conversions) * 100.0 / nullif((SELECT count(*) FROM dealer_enquiries), 0), 1), 0),
    'completedConversionPercent', coalesce(round((SELECT sold FROM conversions) * 100.0 / nullif((SELECT count(*) FROM dealer_enquiries), 0), 1), 0),
    'completedSales', (SELECT count(*)::int FROM active_sales WHERE sold),
    'totalSales', (SELECT count(*)::int FROM active_sales),
    'stockCount', (SELECT count(*)::int FROM vehicles WHERE dealer_id = $1 AND inventory_status IN ('available','reserved') AND missing_count < $3 AND NOT (price_review_required AND source_price IS NULL AND website_price_override IS NULL)),
    'appointments', coalesce((SELECT jsonb_agg(row) FROM (
      SELECT id, customer_name AS customer, coalesce(vehicle_title, '') AS vehicle, appointment_at AS at, coalesce(appointment_status, 'confirmed') AS status
      FROM upcoming ORDER BY appointment_at, id LIMIT 10) row), '[]'::jsonb),
    'balances', coalesce((SELECT jsonb_agg(row) FROM (
      SELECT id, reference, coalesce(draft->>'customer', '') AS customer, balance_pence AS "balancePence"
      FROM money_sales WHERE balance_pence > 0 ORDER BY updated_at DESC, id LIMIT 10) row), '[]'::jsonb),
    'deliveries', coalesce((SELECT jsonb_agg(row) FROM (
      SELECT id, reference, coalesce(draft->>'customer', '') AS customer, coalesce(draft#>>'{fulfilment,scheduledDate}', '') AS "scheduledDate", coalesce(draft#>>'{fulfilment,timeWindow}', '') AS "timeWindow"
      FROM deliveries ORDER BY coalesce(draft#>>'{fulfilment,scheduledDate}', ''), updated_at DESC, id LIMIT 10) row), '[]'::jsonb)
  ) AS summary`,
    [dealerId, now.toISOString(), missingThreshold],
  );
  const summary = result.rows[0]?.summary as OperationsData;
  if (!summary || !Number.isSafeInteger(summary.outstandingBalancePence))
    throw new Error("Dealer summary contains an invalid money total.");
  summary.appointments = summary.appointments.map((row) => ({
    ...row,
    at: new Date(row.at!).toISOString(),
  }));
  return summary;
}
