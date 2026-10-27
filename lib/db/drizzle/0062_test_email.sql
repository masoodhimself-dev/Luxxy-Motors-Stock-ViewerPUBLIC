CREATE TABLE test_email_settings (
  dealer_id text PRIMARY KEY,
  email text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE sales_test_email_previews (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sales_test_sessions(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  attachment_name text,
  attachment_content text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','unknown')),
  created_at timestamptz NOT NULL DEFAULT now()
);
