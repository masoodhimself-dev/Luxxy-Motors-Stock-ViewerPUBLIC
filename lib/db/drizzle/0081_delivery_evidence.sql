CREATE UNIQUE INDEX sale_workspace_tenant_identity_idx ON sale_workspace(id,dealer_id);
--> statement-breakpoint
CREATE TABLE sale_delivery_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id text NOT NULL,
 sale_id uuid NOT NULL,
 vehicle_id uuid NOT NULL, request_id uuid NOT NULL, create_hash text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 context_hash text NOT NULL, snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, revoked_by text,
 submitted_at timestamptz, submission_request_id uuid, submission_hash text, submission jsonb,
 UNIQUE(dealer_id,request_id), UNIQUE(id,dealer_id),
 FOREIGN KEY(sale_id,dealer_id) REFERENCES sale_workspace(id,dealer_id) ON DELETE RESTRICT,
 CHECK(expires_at > created_at),
 CHECK((submitted_at IS NULL AND submission IS NULL) OR (submitted_at IS NOT NULL AND submission IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX sale_delivery_evidence_sale_idx ON sale_delivery_evidence(dealer_id,sale_id,created_at DESC);
--> statement-breakpoint
CREATE INDEX sale_delivery_evidence_vehicle_idx ON sale_delivery_evidence(dealer_id,vehicle_id,submitted_at DESC);
--> statement-breakpoint
CREATE TABLE sale_delivery_evidence_photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id text NOT NULL,
 job_id uuid NOT NULL,
 request_id uuid NOT NULL, request_hash text NOT NULL, phase text NOT NULL CHECK(phase IN ('departure','arrival','paper')),
 slot text NOT NULL CHECK(slot IN ('front','rear','left','right','dashboard','damage','declaration')),
 captured_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp')),
 byte_size integer NOT NULL CHECK(byte_size > 0 AND byte_size <= 2097152),
 width integer NOT NULL, height integer NOT NULL, digest text NOT NULL, bytes bytea NOT NULL,
 UNIQUE(dealer_id,job_id,request_id),
 FOREIGN KEY(job_id,dealer_id) REFERENCES sale_delivery_evidence(id,dealer_id) ON DELETE RESTRICT
);
