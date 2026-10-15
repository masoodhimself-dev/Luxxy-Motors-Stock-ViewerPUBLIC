CREATE TABLE "dealer_demos" (
  "dealer_id" text PRIMARY KEY REFERENCES "dealerships"("id"),
  "logo_data" text,
  "recipient" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "baseline" jsonb,
  "revision" integer NOT NULL DEFAULT 0,
  "last_reset_at" timestamptz,
  "updated_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
