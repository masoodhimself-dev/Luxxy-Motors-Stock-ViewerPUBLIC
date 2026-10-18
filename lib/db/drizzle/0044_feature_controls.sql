CREATE TABLE IF NOT EXISTS platform_feature_defaults (
  feature_key text PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('enabled', 'disabled')),
  disabled_at timestamptz,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS dealer_feature_overrides (
  dealer_id text NOT NULL REFERENCES dealerships(id),
  feature_key text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('inherit', 'enabled', 'disabled')),
  disabled_at timestamptz,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL,
  PRIMARY KEY (dealer_id, feature_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS feature_policy_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id text REFERENCES dealerships(id),
  feature_key text NOT NULL,
  before_rule jsonb NOT NULL,
  after_rule jsonb NOT NULL,
  reason text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS feature_policy_audit_scope_created_idx ON feature_policy_audit(dealer_id, created_at DESC);
