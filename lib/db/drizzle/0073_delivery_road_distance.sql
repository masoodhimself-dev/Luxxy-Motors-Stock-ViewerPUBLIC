CREATE TABLE IF NOT EXISTS road_distance_cache (
 route_key text PRIMARY KEY,
 metres double precision NOT NULL CHECK(metres>=0),
 expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS road_distance_cache_expiry ON road_distance_cache(expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS road_routing_usage (
 bucket text PRIMARY KEY,
 count integer NOT NULL DEFAULT 0
);
