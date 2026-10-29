-- Empty by default. Only a reviewed catalogue replacement enables an official feed.
CREATE TABLE IF NOT EXISTS cazoo_feed_authority (
 dealer_id text PRIMARY KEY REFERENCES dealerships(id),
 retailer_id text NOT NULL,
 feed_id text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 activated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT cazoo_feed_authority_feed_check CHECK(feed_id ~ '^AETA[0-9]+$')
);
