ALTER TABLE "dealer_integrations" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "timezone" text DEFAULT 'Europe/London' NOT NULL;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "currency" text DEFAULT 'GBP' NOT NULL;--> statement-breakpoint
ALTER TABLE "dealers" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_status_check" CHECK ("dealers"."status" in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_currency_check" CHECK ("dealers"."currency" ~ '^[A-Z]{3}$');--> statement-breakpoint
UPDATE "dealer_integrations" SET "external_account_id" = '10040438', "is_primary" = true
WHERE "id" = '50000000-0000-4000-8000-000000000001';