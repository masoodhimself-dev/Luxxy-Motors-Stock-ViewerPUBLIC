ALTER TABLE sales_test_sessions ADD COLUMN customer_name text NOT NULL DEFAULT '[TEST] Example Buyer';
--> statement-breakpoint
ALTER TABLE sales_test_sessions ADD COLUMN customer_phone text NOT NULL DEFAULT '07700900123';
--> statement-breakpoint
ALTER TABLE sales_test_sessions ADD COLUMN customer_email text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE sales_test_sessions ADD COLUMN vehicle_title text NOT NULL DEFAULT '[TEST] Example Car';
--> statement-breakpoint
ALTER TABLE sales_test_sessions ADD COLUMN vehicle_registration text NOT NULL DEFAULT 'TEST 01';
--> statement-breakpoint
ALTER TABLE sales_test_sessions ADD COLUMN vehicle_price integer NOT NULL DEFAULT 1000;
