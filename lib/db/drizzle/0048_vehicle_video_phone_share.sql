CREATE TABLE vehicle_videos (
 id uuid PRIMARY KEY, dealer_id text NOT NULL, vehicle_id uuid NOT NULL REFERENCES vehicles(id),
 source_digest text NOT NULL, object_key text NOT NULL, status text NOT NULL CHECK(status IN ('processing','ready','failed')),
 published boolean NOT NULL DEFAULT false, revision integer NOT NULL DEFAULT 1,
 duration_ms integer, byte_size integer, width integer, height integer,
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (duration_ms IS NULL OR duration_ms BETWEEN 1 AND 20000), CHECK(byte_size IS NULL OR byte_size BETWEEN 1 AND 5242880),
 CHECK(NOT published OR status='ready')
);
--> statement-breakpoint
CREATE UNIQUE INDEX vehicle_videos_one_published ON vehicle_videos(dealer_id,vehicle_id) WHERE published;
--> statement-breakpoint
CREATE INDEX vehicle_videos_dealer_car ON vehicle_videos(dealer_id,vehicle_id,created_at);
--> statement-breakpoint
CREATE TABLE customer_phone_shares (
 id uuid PRIMARY KEY, dealer_id text NOT NULL, request_id uuid NOT NULL, token_hash text NOT NULL UNIQUE,
 fingerprint text NOT NULL, payload jsonb NOT NULL, created_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
 UNIQUE(dealer_id,request_id), CHECK(expires_at>created_at)
);
--> statement-breakpoint
CREATE INDEX customer_phone_shares_expiry ON customer_phone_shares(dealer_id,expires_at);
