-- Read-only aggregate inspection only. Never use this file to delete/reset data.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='3s';
SET LOCAL idle_in_transaction_session_timeout='60s';

WITH dealer_ids AS (
  SELECT id FROM public.dealerships
  UNION SELECT dealer_id FROM public.enquiries
  UNION SELECT dealer_id FROM public.sale_workspace
  UNION SELECT dealer_id FROM public.sales
  UNION SELECT dealer_id FROM public.leads
  UNION SELECT dealer_id FROM public.customers
), workspace AS (
  SELECT w.id,w.dealer_id,w.state,
    CASE WHEN jsonb_typeof(state->'payments')='array' THEN state->'payments' ELSE '[]'::jsonb END AS payments,
    CASE WHEN jsonb_typeof(state->'documents')='array' THEN state->'documents' ELSE '[]'::jsonb END AS documents,
    (jsonb_typeof(state) IS DISTINCT FROM 'object'
      OR jsonb_typeof(state->'draft') IS DISTINCT FROM 'object'
      OR jsonb_typeof(state->'payments') IS DISTINCT FROM 'array'
      OR jsonb_typeof(state->'documents') IS DISTINCT FROM 'array') AS malformed_shape
  FROM public.sale_workspace w
)
SELECT
  d.id AS dealer_id,ds.name AS dealer_name,ds.status AS dealer_status,
  transaction_timestamp() AS snapshot_at,
  current_setting('transaction_read_only') AS read_only,
  current_setting('transaction_isolation') AS isolation,
  (SELECT count(*) FROM public.enquiries e WHERE e.dealer_id=d.id) AS enquiries,
  (SELECT count(*) FROM public.enquiries e WHERE e.dealer_id=d.id
    AND e.appointment_at>transaction_timestamp() AND e.appointment_cancelled_at IS NULL AND e.attendance='scheduled') AS future_bookings,
  (SELECT count(*) FROM public.enquiries e WHERE e.dealer_id=d.id
    AND (e.type='viewing' OR e.appointment_at IS NOT NULL OR e.appointment_cancelled_at IS NOT NULL OR e.appointment_revision>0)) AS booking_history,
  (SELECT count(*) FROM public.enquiries e WHERE e.dealer_id=d.id AND EXISTS (
    SELECT 1 FROM workspace w WHERE w.dealer_id=e.dealer_id
      AND strpos((CASE WHEN jsonb_typeof(w.state)='object' THEN w.state-'documentArchives'-'providerPayments'-'requests' ELSE w.state END)::text,e.id::text)>0
  )) AS enquiries_referenced_in_saved_sales,
  (SELECT count(*) FROM public.enquiries e WHERE e.dealer_id=d.id AND EXISTS (
    SELECT 1 FROM public.sales s WHERE s.enquiry_id=e.id
  )) AS enquiries_linked_to_legacy_sales,
  (SELECT count(*) FROM workspace w WHERE w.dealer_id=d.id) AS workspace_sales,
  (SELECT coalesce(sum(jsonb_array_length(w.payments)),0) FROM workspace w WHERE w.dealer_id=d.id) AS workspace_payment_entries,
  (SELECT coalesce(sum(jsonb_array_length(w.documents)),0) FROM workspace w WHERE w.dealer_id=d.id) AS workspace_document_entries,
  (SELECT count(*) FROM workspace w CROSS JOIN LATERAL jsonb_array_elements(w.documents) doc
    WHERE w.dealer_id=d.id AND doc->>'type'='invoice') AS workspace_invoices,
  (SELECT count(*) FROM workspace w WHERE w.dealer_id=d.id
    AND (w.state#>>'{lifecycle,status}' IN ('reserved','sold') OR nullif(w.state->>'completedAt','') IS NOT NULL)) AS workspace_reserved_sold_completed,
  (SELECT count(*) FROM workspace w WHERE w.dealer_id=d.id AND (w.malformed_shape
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(w.payments) p WHERE jsonb_typeof(p) IS DISTINCT FROM 'object'
      OR jsonb_typeof(p->'amountPence') IS DISTINCT FROM 'number' OR coalesce(p->>'amountPence','') !~ '^[0-9]+$'
      OR jsonb_typeof(p->'signedAmountPence') IS DISTINCT FROM 'number' OR coalesce(p->>'signedAmountPence','') !~ '^-?[0-9]+$')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(w.documents) doc WHERE jsonb_typeof(doc) IS DISTINCT FROM 'object'
      OR jsonb_typeof(doc->'snapshot') IS DISTINCT FROM 'object')
  )) AS workspace_malformed_or_unknown_ledgers,
  (SELECT count(*) FROM public.sales s WHERE s.dealer_id=d.id) AS legacy_sales,
  (SELECT count(*) FROM public.invoices i JOIN public.sales s ON s.id=i.sale_id WHERE s.dealer_id=d.id) AS legacy_invoices,
  (SELECT count(*) FROM public.sale_payments p JOIN public.sales s ON s.id=p.sale_id WHERE s.dealer_id=d.id) AS legacy_payment_entries,
  (SELECT count(*) FROM public.customers c WHERE c.dealer_id=d.id) AS customers,
  (SELECT count(*) FROM public.leads l WHERE l.dealer_id=d.id) AS leads,
  (SELECT count(*) FROM public.leads l WHERE l.dealer_id=d.id AND (l.deposit_pence>0 OR l.deposit_taken_at IS NOT NULL)) AS leads_with_deposit_history,
  (SELECT count(*) FROM public.lead_events e JOIN public.leads l ON l.id=e.lead_id WHERE l.dealer_id=d.id
    AND e.payload->>'kind' IN ('online_reservation','online_stripe_reservation')) AS historical_online_reservations,
  (SELECT count(*) FROM public.enquiry_emails e WHERE e.dealer_id=d.id) AS email_delivery_journal,
  (SELECT count(*) FROM public.enquiry_email_replies e WHERE e.dealer_id=d.id) AS incoming_replies,
  (SELECT count(*) FROM public.enquiry_email_reply_routes e WHERE e.dealer_id=d.id) AS reply_routes,
  (SELECT count(*) FROM public.email_outbox e WHERE e.dealer_id=d.id AND e.status IN ('queued','sending')) AS active_email_outbox,
  (SELECT count(*) FROM public.test_drive_declarations e WHERE e.dealer_id=d.id) AS test_drive_declarations,
  (SELECT count(*) FROM public.sold_vehicle_follow_ups e WHERE e.dealer_id=d.id) AS sold_followups,
  (SELECT count(*) FROM public.customer_phone_shares e WHERE e.dealer_id=d.id AND e.revoked_at IS NULL AND e.expires_at>transaction_timestamp()) AS active_phone_shares,
  (SELECT count(*) FROM public.vehicles v WHERE v.dealer_id=d.id) AS vehicles,
  (SELECT count(*) FROM public.vehicles v WHERE v.dealer_id=d.id AND v.inventory_status IN ('reserved','sold')) AS reserved_or_sold_stock,
  (SELECT count(*) FROM public.sale_workspace_counters c WHERE c.dealer_id=d.id) AS invoice_counter_rows
FROM dealer_ids d LEFT JOIN public.dealerships ds ON ds.id=d.id ORDER BY d.id;

ROLLBACK;
