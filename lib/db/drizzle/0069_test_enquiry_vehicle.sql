ALTER TABLE sales_test_sessions ADD COLUMN source_vehicle_id uuid;
--> statement-breakpoint
ALTER TABLE sales_test_enquiries ADD COLUMN vehicle_registration text NOT NULL DEFAULT '';
--> statement-breakpoint
UPDATE sales_test_enquiries e SET vehicle_registration=s.vehicle_registration FROM sales_test_sessions s WHERE e.session_id=s.id AND e.vehicle_id=s.vehicle_id;
