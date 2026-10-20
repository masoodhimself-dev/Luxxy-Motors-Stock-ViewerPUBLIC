CREATE TABLE stock_change_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id text NOT NULL,
  vehicle_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('price_drop','missing_stock')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved')),
  change_key text NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  previous_price integer,
  current_price integer,
  missing_count integer NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
  last_seen_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  note text,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (vehicle_id, dealer_id) REFERENCES vehicles(id, dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_change_tasks_dealer_change_uidx ON stock_change_tasks(dealer_id, change_key);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_change_tasks_current_kind_uidx ON stock_change_tasks(dealer_id, vehicle_id, kind) WHERE resolved_at IS NULL;
--> statement-breakpoint
CREATE INDEX stock_change_tasks_home_idx ON stock_change_tasks(dealer_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX enquiries_stock_change_customers_idx ON enquiries(dealer_id, vehicle_id, created_at DESC) WHERE merged_into_id IS NULL AND status <> 'closed';
--> statement-breakpoint
CREATE INDEX vehicle_changes_public_price_idx ON vehicle_changes(vehicle_id, changed_at DESC, id DESC) WHERE field_name = 'websitePublishedPrice';
--> statement-breakpoint
CREATE INDEX leads_stock_change_deposits_idx ON leads(dealer_id, vehicle_id) WHERE deposit_pence > 0 AND closed_at IS NULL;
--> statement-breakpoint
CREATE INDEX sale_workspace_stock_change_vehicle_idx ON sale_workspace(dealer_id, (state#>>'{draft,vehicleId}'));
