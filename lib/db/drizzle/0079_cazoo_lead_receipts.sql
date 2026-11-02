CREATE TABLE cazoo_lead_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_id uuid NOT NULL UNIQUE,
 dealer_id text NOT NULL REFERENCES dealerships(id),
 mailbox text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','imported','review','duplicate')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 correlation_id text, enquiry_id uuid,
 subject text, review_text text, error_code text,
 draft_status text NOT NULL DEFAULT 'pending' CHECK(draft_status IN ('pending','generating','ready','skipped','failed')),
 draft_lease_until timestamptz,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(dealer_id,correlation_id),
 FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX cazoo_lead_receipts_due ON cazoo_lead_receipts(next_attempt_at) WHERE status IN ('pending','processing');
--> statement-breakpoint
CREATE INDEX cazoo_lead_receipts_dealer ON cazoo_lead_receipts(dealer_id,received_at DESC);
