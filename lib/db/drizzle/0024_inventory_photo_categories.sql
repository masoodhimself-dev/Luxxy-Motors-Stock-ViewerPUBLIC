ALTER TABLE vehicle_service_photos ADD COLUMN category text NOT NULL DEFAULT 'service_book' CHECK (category IN ('service_book','pre_accident'));
--> statement-breakpoint
ALTER TABLE vehicle_service_upload_sessions ADD COLUMN category text NOT NULL DEFAULT 'service_book' CHECK (category IN ('service_book','pre_accident'));
