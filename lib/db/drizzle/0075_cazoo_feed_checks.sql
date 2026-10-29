-- Private, collection-only candidates. This migration does not touch stock,
-- enquiries, bookings, invoices, payments, import permissions or credentials.
CREATE TABLE IF NOT EXISTS cazoo_feed_checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dealer_id text NOT NULL REFERENCES dealerships(id),
 slot_key text NOT NULL,
 status text NOT NULL,
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz,
 received_at timestamptz NOT NULL,
 completed_at timestamptz,
 file_hash text,
 file_bytes integer,
 remote_modified_at timestamptz,
 vehicle_count integer,
 based_on_check_id uuid,
 warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
 candidate jsonb,
 reconciliation jsonb,
 error_code text,
 error_message text,
 CONSTRAINT cazoo_feed_checks_status_check CHECK (status IN ('processing','ready','blocked','unchanged','failed')),
 CONSTRAINT cazoo_feed_checks_attempts_check CHECK (attempts BETWEEN 0 AND 3),
 CONSTRAINT cazoo_feed_checks_hash_check CHECK (file_hash IS NULL OR file_hash ~ '^[a-f0-9]{64}$'),
 CONSTRAINT cazoo_feed_checks_count_check CHECK ((vehicle_count IS NULL OR vehicle_count >= 0) AND (file_bytes IS NULL OR file_bytes >= 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS cazoo_feed_checks_dealer_slot_uidx ON cazoo_feed_checks(dealer_id, slot_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cazoo_feed_checks_dealer_received_idx ON cazoo_feed_checks(dealer_id, received_at DESC);
