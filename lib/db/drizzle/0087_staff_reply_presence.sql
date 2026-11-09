CREATE TABLE IF NOT EXISTS staff_reply_presence (
  dealer_id text NOT NULL,
  enquiry_id uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  staff_id text NOT NULL,
  staff_name text NOT NULL,
  session_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(dealer_id,enquiry_id)
);
CREATE INDEX IF NOT EXISTS staff_reply_presence_expiry_idx ON staff_reply_presence(expires_at);
