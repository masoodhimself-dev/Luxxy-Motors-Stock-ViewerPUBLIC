CREATE TYPE "public"."dealer_integration_status" AS ENUM('pending', 'active', 'disabled', 'error');--> statement-breakpoint
CREATE TYPE "public"."dealer_membership_role" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "dealer_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dealer_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_domains_hostname_unique" UNIQUE("hostname"),
	CONSTRAINT "dealer_domains_lowercase_hostname_check" CHECK ("dealer_domains"."hostname" = lower("dealer_domains"."hostname"))
);
--> statement-breakpoint
CREATE TABLE "dealer_integrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dealer_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"external_account_id" text,
	"status" "dealer_integration_status" DEFAULT 'pending' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_integrations_id_dealer_unique" UNIQUE("id","dealer_id")
);
--> statement-breakpoint
CREATE TABLE "dealer_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "dealer_membership_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"legacy_dealer_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealers_legacy_dealer_id_unique" UNIQUE("legacy_dealer_id")
);
--> statement-breakpoint
CREATE TABLE "integration_collector_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_integration_id" uuid NOT NULL,
	"label" text NOT NULL,
	"verifier_hash" text NOT NULL,
	"verifier_salt" text NOT NULL,
	"hash_algorithm" text DEFAULT 'scrypt' NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_collector_credentials_hash_algorithm_check" CHECK ("integration_collector_credentials"."hash_algorithm" in ('scrypt', 'argon2id')),
	CONSTRAINT "integration_collector_credentials_hash_not_empty_check" CHECK (length("integration_collector_credentials"."verifier_hash") >= 32 and length("integration_collector_credentials"."verifier_salt") >= 16)
);
--> statement-breakpoint
CREATE TABLE "integration_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_providers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_lowercase_email_check" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "stock_import_runs" ADD COLUMN "tenant_dealer_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_import_runs" ADD COLUMN "dealer_integration_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "tenant_dealer_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "dealer_integration_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD COLUMN "tenant_dealer_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD COLUMN "dealer_integration_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD COLUMN "tenant_dealer_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD COLUMN "dealer_integration_id" uuid;--> statement-breakpoint
ALTER TABLE "dealer_domains" ADD CONSTRAINT "dealer_domains_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_integrations" ADD CONSTRAINT "dealer_integrations_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_integrations" ADD CONSTRAINT "dealer_integrations_provider_id_integration_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."integration_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_memberships" ADD CONSTRAINT "dealer_memberships_dealer_id_dealers_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_memberships" ADD CONSTRAINT "dealer_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_collector_credentials" ADD CONSTRAINT "integration_collector_credentials_dealer_integration_id_dealer_integrations_id_fk" FOREIGN KEY ("dealer_integration_id") REFERENCES "public"."dealer_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dealer_domains_dealer_id_idx" ON "dealer_domains" USING btree ("dealer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dealer_integrations_dealer_provider_uidx" ON "dealer_integrations" USING btree ("dealer_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dealer_memberships_dealer_user_uidx" ON "dealer_memberships" USING btree ("dealer_id","user_id");--> statement-breakpoint
CREATE INDEX "dealer_memberships_user_id_idx" ON "dealer_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dealers_organization_slug_uidx" ON "dealers" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_collector_credentials_integration_label_uidx" ON "integration_collector_credentials" USING btree ("dealer_integration_id","label");--> statement-breakpoint
ALTER TABLE "stock_import_runs" ADD CONSTRAINT "stock_import_runs_tenant_dealer_id_dealers_id_fk" FOREIGN KEY ("tenant_dealer_id") REFERENCES "public"."dealers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_import_runs" ADD CONSTRAINT "stock_import_runs_integration_dealer_fk" FOREIGN KEY ("dealer_integration_id","tenant_dealer_id") REFERENCES "public"."dealer_integrations"("id","dealer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_import_runs" ADD CONSTRAINT "stock_import_runs_id_tenant_dealer_unique" UNIQUE("id","tenant_dealer_id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_dealer_id_dealers_id_fk" FOREIGN KEY ("tenant_dealer_id") REFERENCES "public"."dealers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_integration_dealer_fk" FOREIGN KEY ("dealer_integration_id","tenant_dealer_id") REFERENCES "public"."dealer_integrations"("id","dealer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_id_tenant_dealer_unique" UNIQUE("id","tenant_dealer_id");--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_tenant_dealer_id_dealers_id_fk" FOREIGN KEY ("tenant_dealer_id") REFERENCES "public"."dealers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_dealer_fk" FOREIGN KEY ("vehicle_id","tenant_dealer_id") REFERENCES "public"."vehicles"("id","tenant_dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_integration_dealer_fk" FOREIGN KEY ("dealer_integration_id","tenant_dealer_id") REFERENCES "public"."dealer_integrations"("id","dealer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_tenant_dealer_id_dealers_id_fk" FOREIGN KEY ("tenant_dealer_id") REFERENCES "public"."dealers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_vehicle_dealer_fk" FOREIGN KEY ("vehicle_id","tenant_dealer_id") REFERENCES "public"."vehicles"("id","tenant_dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_run_dealer_fk" FOREIGN KEY ("import_run_id","tenant_dealer_id") REFERENCES "public"."stock_import_runs"("id","tenant_dealer_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_integration_dealer_fk" FOREIGN KEY ("dealer_integration_id","tenant_dealer_id") REFERENCES "public"."dealer_integrations"("id","dealer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_import_runs_tenant_dealer_id_idx" ON "stock_import_runs" USING btree ("tenant_dealer_id");--> statement-breakpoint
CREATE INDEX "stock_import_runs_dealer_integration_id_idx" ON "stock_import_runs" USING btree ("dealer_integration_id");--> statement-breakpoint
CREATE INDEX "vehicles_tenant_dealer_id_idx" ON "vehicles" USING btree ("tenant_dealer_id");--> statement-breakpoint
CREATE INDEX "vehicles_dealer_integration_id_idx" ON "vehicles" USING btree ("dealer_integration_id");--> statement-breakpoint
CREATE INDEX "vehicle_images_tenant_dealer_id_idx" ON "vehicle_images" USING btree ("tenant_dealer_id");--> statement-breakpoint
CREATE INDEX "vehicle_images_dealer_integration_id_idx" ON "vehicle_images" USING btree ("dealer_integration_id");--> statement-breakpoint
CREATE INDEX "vehicle_changes_tenant_dealer_id_idx" ON "vehicle_changes" USING btree ("tenant_dealer_id");--> statement-breakpoint
CREATE INDEX "vehicle_changes_dealer_integration_id_idx" ON "vehicle_changes" USING btree ("dealer_integration_id");--> statement-breakpoint
INSERT INTO "organizations" ("id", "slug", "name") VALUES
('10000000-0000-4000-8000-000000000001', 'luxxy-motors', 'Luxxy Motors')
ON CONFLICT ("id") DO UPDATE SET "slug" = EXCLUDED."slug", "name" = EXCLUDED."name";--> statement-breakpoint
INSERT INTO "dealers" ("id", "organization_id", "slug", "name", "legacy_dealer_id") VALUES
('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'luxxy-motors', 'Luxxy Motors', 'luxxy-motors')
ON CONFLICT ("id") DO UPDATE SET "organization_id" = EXCLUDED."organization_id", "slug" = EXCLUDED."slug",
"name" = EXCLUDED."name", "legacy_dealer_id" = EXCLUDED."legacy_dealer_id";--> statement-breakpoint
INSERT INTO "dealer_domains" ("id", "dealer_id", "hostname", "verified", "is_primary") VALUES
('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'luxxymotors.co.uk', true, true)
ON CONFLICT ("id") DO UPDATE SET "dealer_id" = EXCLUDED."dealer_id", "hostname" = EXCLUDED."hostname",
"verified" = true, "is_primary" = true;--> statement-breakpoint
INSERT INTO "integration_providers" ("id", "key", "name") VALUES
('40000000-0000-4000-8000-000000000001', 'autotrader', 'Auto Trader')
ON CONFLICT ("id") DO UPDATE SET "key" = EXCLUDED."key", "name" = EXCLUDED."name";--> statement-breakpoint
INSERT INTO "dealer_integrations" ("id", "dealer_id", "provider_id", "status") VALUES
('50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'active')
ON CONFLICT ("id") DO UPDATE SET "dealer_id" = EXCLUDED."dealer_id",
"provider_id" = EXCLUDED."provider_id", "status" = EXCLUDED."status";--> statement-breakpoint
UPDATE "stock_import_runs" SET "tenant_dealer_id" = '20000000-0000-4000-8000-000000000001',
"dealer_integration_id" = '50000000-0000-4000-8000-000000000001'
WHERE "dealer_id" = 'luxxy-motors' AND "source" = 'autotrader';--> statement-breakpoint
UPDATE "vehicles" SET "tenant_dealer_id" = '20000000-0000-4000-8000-000000000001',
"dealer_integration_id" = '50000000-0000-4000-8000-000000000001'
WHERE "dealer_id" = 'luxxy-motors' AND "source" = 'autotrader';--> statement-breakpoint
UPDATE "vehicle_images" AS i SET "tenant_dealer_id" = v."tenant_dealer_id",
"dealer_integration_id" = v."dealer_integration_id" FROM "vehicles" AS v
WHERE i."vehicle_id" = v."id" AND v."tenant_dealer_id" = '20000000-0000-4000-8000-000000000001';--> statement-breakpoint
UPDATE "vehicle_changes" AS c SET "tenant_dealer_id" = v."tenant_dealer_id",
"dealer_integration_id" = v."dealer_integration_id" FROM "vehicles" AS v
WHERE c."vehicle_id" = v."id" AND v."tenant_dealer_id" = '20000000-0000-4000-8000-000000000001';