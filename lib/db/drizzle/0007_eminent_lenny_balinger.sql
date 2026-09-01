CREATE TABLE "dealer_settings" (
	"dealer_id" text PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
