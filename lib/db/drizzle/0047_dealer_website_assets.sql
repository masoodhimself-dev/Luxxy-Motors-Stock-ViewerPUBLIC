CREATE TABLE dealer_website_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id text NOT NULL,
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  bytes bytea NOT NULL,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  digest text NOT NULL,
  uploaded_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dealer_website_assets_mime_check CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  CONSTRAINT dealer_website_assets_size_check CHECK (byte_size>0 AND byte_size<=2097152 AND octet_length(bytes)=byte_size),
  CONSTRAINT dealer_website_assets_dimensions_check CHECK (width>0 AND width<=4096 AND height>0 AND height<=4096 AND width::bigint*height<=12000000),
  CONSTRAINT dealer_website_assets_hash_check CHECK (digest ~ '^[0-9a-f]{64}$' AND request_hash ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX dealer_website_assets_request_uidx ON dealer_website_assets(dealer_id,request_id);
--> statement-breakpoint
CREATE INDEX dealer_website_assets_quota_idx ON dealer_website_assets(dealer_id,created_at);
