CREATE TYPE "public"."stock_import_status" AS ENUM('pending', 'processing', 'completed', 'quarantined', 'failed');--> statement-breakpoint
CREATE TYPE "public"."inventory_status" AS ENUM('available', 'reserved', 'sold', 'hidden', 'archived');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('live', 'missing');--> statement-breakpoint
CREATE TYPE "public"."vehicle_image_origin" AS ENUM('source', 'manual');--> statement-breakpoint
CREATE TABLE "stock_import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"dealer_id" text NOT NULL,
	"source" text NOT NULL,
	"retailer_id" text NOT NULL,
	"schema_version" text NOT NULL,
	"scraped_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_count" integer NOT NULL,
	"received_count" integer NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"status" "stock_import_status" DEFAULT 'pending' NOT NULL,
	"failed_advert_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_snapshot" jsonb NOT NULL,
	"added_count" integer DEFAULT 0 NOT NULL,
	"changed_count" integer DEFAULT 0 NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_run_id" uuid,
	"dealer_id" text NOT NULL,
	"source" text NOT NULL,
	"advert_id" text NOT NULL,
	"inventory_status" "inventory_status" DEFAULT 'available' NOT NULL,
	"source_status" "source_status" DEFAULT 'live' NOT NULL,
	"title" text,
	"variant" text,
	"make" text,
	"model" text,
	"trim" text,
	"year" integer,
	"source_price" integer,
	"pending_source_price" integer,
	"price_review_required" boolean DEFAULT false NOT NULL,
	"website_price_override" integer,
	"price_type" text,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"mileage" integer,
	"mileage_text" text,
	"registration_band" text,
	"registration" text,
	"plate" text,
	"vrm" text,
	"vrm_verified" boolean DEFAULT false NOT NULL,
	"fuel" text,
	"transmission" text,
	"body_type" text,
	"engine_size" text,
	"engine_cc" integer,
	"doors" integer,
	"seats" integer,
	"colour" text,
	"emission_class" text,
	"drivetrain" text,
	"owners" integer,
	"write_off_category" text,
	"advert_url" text,
	"dealer_name" text,
	"dealer_location" text,
	"image_count" integer,
	"source_hero_image" text,
	"website_title_override" text,
	"website_description" text,
	"website_hero_image_override" text,
	"website_featured" boolean DEFAULT false NOT NULL,
	"raw_source_data" jsonb,
	"audit_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"missing_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_nonnegative_values_check" CHECK (("vehicles"."source_price" is null or "vehicles"."source_price" >= 0)
         and ("vehicles"."pending_source_price" is null or "vehicles"."pending_source_price" >= 0)
        and ("vehicles"."website_price_override" is null or "vehicles"."website_price_override" >= 0)
        and ("vehicles"."mileage" is null or "vehicles"."mileage" >= 0)
        and ("vehicles"."image_count" is null or "vehicles"."image_count" >= 0)
        and "vehicles"."missing_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vehicle_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"origin" "vehicle_image_origin" DEFAULT 'source' NOT NULL,
	"source_url" text NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_hero" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"raw_source_data" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"import_run_id" uuid,
	"field_name" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"audit_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_import_run_id_stock_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."stock_import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_import_run_id_stock_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."stock_import_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_import_runs_run_id_uidx" ON "stock_import_runs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "stock_import_runs_dealer_source_idx" ON "stock_import_runs" USING btree ("dealer_id","source");--> statement-breakpoint
CREATE INDEX "stock_import_runs_status_received_at_idx" ON "stock_import_runs" USING btree ("status","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_dealer_source_advert_uidx" ON "vehicles" USING btree ("dealer_id","source","advert_id");--> statement-breakpoint
CREATE INDEX "vehicles_import_run_id_idx" ON "vehicles" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "vehicles_dealer_inventory_status_idx" ON "vehicles" USING btree ("dealer_id","inventory_status");--> statement-breakpoint
CREATE INDEX "vehicles_dealer_source_status_idx" ON "vehicles" USING btree ("dealer_id","source_status");--> statement-breakpoint
CREATE INDEX "vehicles_vrm_idx" ON "vehicles" USING btree ("vrm");--> statement-breakpoint
CREATE INDEX "vehicles_price_review_required_idx" ON "vehicles" USING btree ("price_review_required");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_images_vehicle_url_uidx" ON "vehicle_images" USING btree ("vehicle_id","source_url");--> statement-breakpoint
CREATE INDEX "vehicle_images_vehicle_sort_order_idx" ON "vehicle_images" USING btree ("vehicle_id","sort_order");--> statement-breakpoint
CREATE INDEX "vehicle_images_vehicle_active_idx" ON "vehicle_images" USING btree ("vehicle_id","is_active");--> statement-breakpoint
CREATE INDEX "vehicle_changes_vehicle_changed_at_idx" ON "vehicle_changes" USING btree ("vehicle_id","changed_at");--> statement-breakpoint
CREATE INDEX "vehicle_changes_import_run_id_idx" ON "vehicle_changes" USING btree ("import_run_id");--> statement-breakpoint
CREATE INDEX "vehicle_changes_field_changed_at_idx" ON "vehicle_changes" USING btree ("field_name","changed_at");