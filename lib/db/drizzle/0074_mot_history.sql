-- Public vehicle MOT records, shared across dealers. No customer or commercial data.
CREATE TABLE IF NOT EXISTS mot_history_cache (
 registration text PRIMARY KEY,
 data jsonb NOT NULL,
 expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mot_history_cache_expiry ON mot_history_cache(expires_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mot_api_usage (
 bucket text PRIMARY KEY,
 count integer NOT NULL DEFAULT 0
);
