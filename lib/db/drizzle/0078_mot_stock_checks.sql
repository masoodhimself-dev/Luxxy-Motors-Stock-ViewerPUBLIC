-- Durable tenant-bound MOT work only; vehicle, customer and financial data are unchanged.
CREATE TABLE IF NOT EXISTS mot_stock_check_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dealer_id text NOT NULL,
 status text NOT NULL DEFAULT 'queued' CONSTRAINT mot_stock_runs_status_check CHECK(status IN ('queued','running','completed','completed_with_errors')),
 total integer NOT NULL DEFAULT 0,
 checked integer NOT NULL DEFAULT 0,
 failed integer NOT NULL DEFAULT 0,
 skipped integer NOT NULL DEFAULT 0,
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mot_stock_runs_id_dealer_uidx ON mot_stock_check_runs(id,dealer_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mot_stock_runs_active_dealer_uidx ON mot_stock_check_runs(dealer_id) WHERE status IN ('queued','running');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mot_stock_runs_dealer_started_idx ON mot_stock_check_runs(dealer_id,started_at DESC);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mot_stock_checks (
 dealer_id text NOT NULL,
 vehicle_id uuid NOT NULL,
 registration text NOT NULL,
 run_id uuid,
 status text NOT NULL DEFAULT 'queued' CONSTRAINT mot_stock_checks_status_check CHECK(status IN ('queued','running','completed','failed','skipped')),
 attempts integer NOT NULL DEFAULT 0,
 error_code text,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_until timestamptz,
 checked_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(dealer_id,vehicle_id),
 FOREIGN KEY(vehicle_id,dealer_id) REFERENCES vehicles(id,dealer_id) ON DELETE CASCADE,
 FOREIGN KEY(run_id,dealer_id) REFERENCES mot_stock_check_runs(id,dealer_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mot_stock_checks_due_idx ON mot_stock_checks(next_attempt_at) WHERE status IN ('queued','running');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mot_stock_checks_run_idx ON mot_stock_checks(dealer_id,run_id);
