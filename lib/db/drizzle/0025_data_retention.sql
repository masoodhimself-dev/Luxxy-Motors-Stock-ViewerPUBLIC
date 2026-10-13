ALTER TABLE vehicles ADD COLUMN archived_at timestamptz, ADD COLUMN retirement_started_at timestamptz;
--> statement-breakpoint
ALTER TABLE vehicles ALTER COLUMN raw_source_data SET STORAGE EXTENDED;
--> statement-breakpoint
ALTER TABLE sale_workspace ALTER COLUMN state SET STORAGE EXTENDED;
