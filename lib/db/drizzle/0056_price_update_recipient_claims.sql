-- One manually approved price update per email and actual price event, shared
-- by Watch and enquiry emails. Claims outlive retained outbox payloads.
CREATE TABLE price_update_recipient_claims(
  dealer_id text NOT NULL,vehicle_id uuid NOT NULL,change_key text NOT NULL,
  email text NOT NULL CHECK(email=lower(trim(email))),source_key text NOT NULL,
  status text NOT NULL CHECK(status IN ('processing','sent','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(dealer_id,vehicle_id,change_key,email),
  FOREIGN KEY(vehicle_id,dealer_id) REFERENCES vehicles(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
-- Preserve approval/acceptance uncertainty for contextual emails queued before
-- this release. No provider request is made by the migration.
INSERT INTO price_update_recipient_claims(dealer_id,vehicle_id,change_key,email,source_key,status,created_at,updated_at)
SELECT o.dealer_id,t.vehicle_id,t.change_key,lower(trim(o.validation#>>'{input,to}')),'enquiry:'||o.delivery_id::text,
  CASE WHEN o.status='sent' THEN 'sent' WHEN o.status IN ('unknown','cancelled') THEN 'uncertain' ELSE 'processing' END,o.created_at,o.updated_at
FROM email_outbox o JOIN stock_change_tasks t ON t.dealer_id=o.dealer_id AND t.id::text=o.validation#>>'{input,stockChange,taskId}'
WHERE o.kind='staff' AND o.delivery_id IS NOT NULL AND o.status IN ('queued','sending','sent','unknown','cancelled') AND t.kind='price_drop' AND nullif(trim(o.validation#>>'{input,to}'),'') IS NOT NULL
ORDER BY CASE WHEN o.status='sent' THEN 0 ELSE 1 END,o.created_at
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO price_update_recipient_claims(dealer_id,vehicle_id,change_key,email,source_key,status,created_at,updated_at)
SELECT e.dealer_id,e.vehicle_id,substring(e.change_key from 7),w.email,'watch:'||d.id::text||':'||d.request_id::text,
  CASE WHEN d.status='sent' THEN 'sent' WHEN d.status='uncertain' THEN 'uncertain' ELSE 'processing' END,d.created_at,d.updated_at
FROM vehicle_watch_deliveries d JOIN vehicle_watch_events e ON e.dealer_id=d.dealer_id AND e.id=d.event_id
JOIN vehicle_watches w ON w.dealer_id=d.dealer_id AND w.id=d.watch_id
WHERE e.kind='price_drop' AND d.status IN ('processing','sent','uncertain')
ORDER BY CASE WHEN d.status='sent' THEN 0 ELSE 1 END,d.created_at
ON CONFLICT DO NOTHING;
