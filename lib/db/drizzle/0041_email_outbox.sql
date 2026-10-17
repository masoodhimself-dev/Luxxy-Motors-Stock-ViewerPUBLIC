CREATE TABLE email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id text NOT NULL,
  enquiry_id uuid NOT NULL,
  delivery_id uuid,
  kind text NOT NULL CHECK (kind IN ('staff','customer','dealer','reminder')),
  send_key text NOT NULL,
  payload text,
  payload_hash text NOT NULL,
  validation_hash text NOT NULL,
  validation jsonb NOT NULL,
  account_hash text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','unknown','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  retry_deadline timestamptz NOT NULL,
  provider_id text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT email_outbox_enquiry_fk FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE,
  CONSTRAINT email_outbox_send_key_unique UNIQUE(dealer_id,send_key)
);
CREATE INDEX email_outbox_due_idx ON email_outbox(dealer_id,next_attempt_at,id) WHERE status IN ('queued','sending');
CREATE INDEX email_outbox_delivery_idx ON email_outbox(dealer_id,delivery_id) WHERE delivery_id IS NOT NULL;
CREATE INDEX email_outbox_global_queued_idx ON email_outbox(next_attempt_at,dealer_id) WHERE status='queued';
CREATE INDEX email_outbox_global_lease_idx ON email_outbox(lease_until,dealer_id) WHERE status='sending';
CREATE INDEX email_outbox_global_deadline_idx ON email_outbox(retry_deadline,dealer_id) WHERE status='queued';
CREATE INDEX email_outbox_payload_retention_idx ON email_outbox(created_at,dealer_id) WHERE payload IS NOT NULL AND status IN ('sent','failed','unknown','cancelled');
CREATE INDEX enquiry_emails_interrupted_idx ON enquiry_emails(created_at,dealer_id) WHERE status='sending';
CREATE TABLE email_account_throttle (
  account_hash text PRIMARY KEY,
  next_allowed_at timestamptz NOT NULL
);
