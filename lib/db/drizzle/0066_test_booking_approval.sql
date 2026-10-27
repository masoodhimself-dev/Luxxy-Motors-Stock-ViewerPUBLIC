ALTER TABLE sales_test_enquiries DROP CONSTRAINT sales_test_enquiries_appointment_status_check;
--> statement-breakpoint
ALTER TABLE sales_test_enquiries ADD CONSTRAINT sales_test_enquiries_appointment_status_check CHECK (appointment_status IN ('pending','confirmed','cancelled'));
--> statement-breakpoint
ALTER TABLE sales_test_enquiries ADD COLUMN part_exchange jsonb;
