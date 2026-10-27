CREATE TABLE sales_test_enquiries (
 id uuid PRIMARY KEY,
 session_id uuid NOT NULL REFERENCES sales_test_sessions(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 request_fingerprint text NOT NULL,
 vehicle_id uuid NOT NULL,
 vehicle_title text NOT NULL,
 customer_name text NOT NULL,
 phone text NOT NULL,
 email text NOT NULL,
 type text NOT NULL CHECK (type IN ('general','viewing','part_exchange')),
 message text NOT NULL,
 appointment_at timestamptz,
 appointment_status text CHECK (appointment_status IN ('confirmed','cancelled')),
 revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id, request_id)
);
--> statement-breakpoint
CREATE TABLE sales_test_enquiry_operations (
 session_id uuid NOT NULL REFERENCES sales_test_sessions(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 enquiry_id uuid NOT NULL REFERENCES sales_test_enquiries(id) ON DELETE CASCADE,
 fingerprint text NOT NULL,
 result jsonb NOT NULL,
 PRIMARY KEY(session_id,request_id)
);
