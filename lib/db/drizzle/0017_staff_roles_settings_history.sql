ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'salesperson';
--> statement-breakpoint
ALTER TABLE portal_users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;
--> statement-breakpoint
-- Preserve the first existing portal owner for each dealer. Additional legacy
-- accounts receive salesperson privileges until explicitly promoted by an owner.
WITH first_staff AS (
  SELECT DISTINCT ON (dealer_id) id FROM portal_users ORDER BY dealer_id, created_at, id
)
UPDATE portal_users SET role = 'owner' WHERE id IN (SELECT id FROM first_staff);
--> statement-breakpoint
ALTER TABLE portal_users ADD CONSTRAINT portal_users_role_check CHECK (role IN ('owner','salesperson','accounts'));
--> statement-breakpoint
ALTER TABLE dealer_settings ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE dealer_settings_versions (
  dealer_id text NOT NULL,
  revision integer NOT NULL,
  config jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by text NOT NULL,
  action text NOT NULL CONSTRAINT dealer_settings_versions_action_check CHECK (action IN ('initial','publish','restore')),
  restored_from integer,
  CONSTRAINT dealer_settings_versions_dealer_id_revision_pk PRIMARY KEY (dealer_id, revision)
);
--> statement-breakpoint
INSERT INTO dealer_settings_versions(dealer_id, revision, config, published_at, published_by, action)
SELECT dealer_id, revision, config, updated_at, 'Existing settings', 'initial' FROM dealer_settings
ON CONFLICT DO NOTHING;
