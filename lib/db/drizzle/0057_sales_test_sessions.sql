CREATE TABLE sales_test_sessions (
  id uuid PRIMARY KEY,
  parent_dealer_id text NOT NULL,
  staff_user_id text NOT NULL,
  sandbox_dealer_id text NOT NULL UNIQUE,
  vehicle_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  cleaned_at timestamptz
);
--> statement-breakpoint
CREATE INDEX sales_test_sessions_owner_idx ON sales_test_sessions(parent_dealer_id, staff_user_id, created_at DESC);
