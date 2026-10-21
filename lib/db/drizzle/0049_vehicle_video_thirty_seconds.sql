ALTER TABLE vehicle_videos DROP CONSTRAINT IF EXISTS vehicle_videos_duration_ms_check;
--> statement-breakpoint
ALTER TABLE vehicle_videos DROP CONSTRAINT IF EXISTS vehicle_videos_duration_check;
--> statement-breakpoint
ALTER TABLE vehicle_videos ADD CONSTRAINT vehicle_videos_duration_check CHECK(duration_ms IS NULL OR duration_ms BETWEEN 1 AND 30000);
