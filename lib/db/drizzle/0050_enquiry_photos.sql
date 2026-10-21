CREATE TABLE enquiry_photos (
 id uuid PRIMARY KEY, dealer_id text NOT NULL, enquiry_id uuid NOT NULL,
 jpeg bytea NOT NULL, byte_size integer NOT NULL CHECK(byte_size BETWEEN 12 AND 512000),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 2000), height integer NOT NULL CHECK(height BETWEEN 1 AND 2000),
 uploaded_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX enquiry_photos_case ON enquiry_photos(dealer_id,enquiry_id,created_at,id);
--> statement-breakpoint
CREATE TABLE enquiry_photo_upload_sessions (
 id uuid PRIMARY KEY, dealer_id text NOT NULL, enquiry_id uuid NOT NULL,
 token_hash text UNIQUE, created_by text NOT NULL, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
 request_id uuid, request_hash text, result_ids jsonb NOT NULL DEFAULT '[]', completed_at timestamptz,
 FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX enquiry_photo_upload_case ON enquiry_photo_upload_sessions(dealer_id,enquiry_id,expires_at);
--> statement-breakpoint
CREATE TABLE customer_email_preparations (
 id uuid PRIMARY KEY, dealer_id text NOT NULL, enquiry_id uuid NOT NULL,
 fingerprint text NOT NULL, created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
