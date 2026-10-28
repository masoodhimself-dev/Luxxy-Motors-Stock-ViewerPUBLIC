-- Public postcode geography is reusable across tenants; dealer locations remain tenant-owned.
CREATE TABLE IF NOT EXISTS postcode_lookup_cache (
 postcode text PRIMARY KEY,
 data jsonb NOT NULL,
 expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS postcode_lookup_cache_expiry ON postcode_lookup_cache(expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS dealer_locations (
 dealer_id text PRIMARY KEY REFERENCES dealer_settings(dealer_id) ON DELETE CASCADE,
 postcode text NOT NULL,
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 region text,
 administrative_area text,
 verified_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS dealer_locations_coordinates ON dealer_locations(latitude,longitude);
