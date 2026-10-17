-- Preparation only: no payloads are removed by this migration.
ALTER TABLE stock_import_runs ADD COLUMN payload_hash text;
--> statement-breakpoint
ALTER TABLE stock_import_runs ADD COLUMN raw_snapshot_compacted_at timestamptz;
--> statement-breakpoint
ALTER TABLE stock_import_runs ALTER COLUMN raw_snapshot DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE stock_import_runs ADD CONSTRAINT stock_import_runs_payload_hash_check CHECK (payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$');
--> statement-breakpoint
ALTER TABLE stock_import_runs ADD CONSTRAINT stock_import_runs_compaction_check CHECK ((raw_snapshot_compacted_at IS NULL AND raw_snapshot IS NOT NULL) OR (raw_snapshot_compacted_at IS NOT NULL AND status = 'completed' AND payload_hash IS NOT NULL AND raw_snapshot IS NULL));
--> statement-breakpoint
CREATE INDEX stock_import_runs_dealer_received_idx ON stock_import_runs (dealer_id, received_at DESC);
--> statement-breakpoint
CREATE INDEX stock_import_runs_dealer_completed_received_idx ON stock_import_runs (dealer_id, received_at DESC) WHERE status = 'completed';
