CREATE TABLE "dealer_domains" (
	"hostname" text PRIMARY KEY NOT NULL,
	"dealer_id" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verification_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealer_import_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealer_private_settings" (
	"dealer_id" text PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"encrypted_payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealerships" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"canonical_origin" text NOT NULL,
	"stock_platform" text NOT NULL,
	"retailer_id" text NOT NULL,
	"source_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "portal_users_auth_user_uidx";--> statement-breakpoint
ALTER TABLE "dealer_domains" ADD CONSTRAINT "dealer_domains_dealer_id_dealerships_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_import_keys" ADD CONSTRAINT "dealer_import_keys_dealer_id_dealerships_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_private_settings" ADD CONSTRAINT "dealer_private_settings_dealer_id_dealerships_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dealer_import_keys_hash_uidx" ON "dealer_import_keys" USING btree ("secret_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_dealer_auth_user_uidx" ON "portal_users" USING btree ("dealer_id","auth_user_id");