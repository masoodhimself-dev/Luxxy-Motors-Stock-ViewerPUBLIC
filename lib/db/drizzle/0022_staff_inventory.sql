CREATE UNIQUE INDEX "vehicles_id_dealer_id_unique" ON "vehicles" USING btree ("id","dealer_id");
--> statement-breakpoint
CREATE TABLE "vehicle_preparation" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"dealer_id" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"tasks" jsonb DEFAULT '{"cleaning":"pending","inspection":"pending","mot":"pending","servicing":"pending"}'::jsonb NOT NULL,
	"assigned_to_id" uuid,
	"due_date" text,
	"notes" text DEFAULT '' NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_service_photos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"dealer_id" text NOT NULL,
	"jpeg" "bytea" NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_photos_size_check" CHECK ("vehicle_service_photos"."byte_size">0 AND "vehicle_service_photos"."byte_size"<=512000),
	CONSTRAINT "service_photos_dimensions_check" CHECK ("vehicle_service_photos"."width">0 AND "vehicle_service_photos"."width"<=2000 AND "vehicle_service_photos"."height">0 AND "vehicle_service_photos"."height"<=2000)
);
--> statement-breakpoint
CREATE TABLE "vehicle_service_upload_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"dealer_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"request_id" uuid,
	"request_hash" text,
	"result_ids" jsonb,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vehicle_preparation" ADD CONSTRAINT "vehicle_preparation_vehicle_id_dealer_id_vehicles_id_dealer_id_fk" FOREIGN KEY ("vehicle_id","dealer_id") REFERENCES "public"."vehicles"("id","dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_service_photos" ADD CONSTRAINT "vehicle_service_photos_vehicle_id_dealer_id_vehicles_id_dealer_id_fk" FOREIGN KEY ("vehicle_id","dealer_id") REFERENCES "public"."vehicles"("id","dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_service_upload_sessions" ADD CONSTRAINT "vehicle_service_upload_sessions_vehicle_id_dealer_id_vehicles_id_dealer_id_fk" FOREIGN KEY ("vehicle_id","dealer_id") REFERENCES "public"."vehicles"("id","dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_photos_vehicle_idx" ON "vehicle_service_photos" USING btree ("dealer_id","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_upload_sessions_token_hash_unique" ON "vehicle_service_upload_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "service_upload_sessions_vehicle_idx" ON "vehicle_service_upload_sessions" USING btree ("dealer_id","vehicle_id");
