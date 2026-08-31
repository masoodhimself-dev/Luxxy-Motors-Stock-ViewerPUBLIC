CREATE TYPE "public"."enquiry_status" AS ENUM('new', 'contacted', 'closed');--> statement-breakpoint
CREATE TYPE "public"."enquiry_type" AS ENUM('viewing', 'general', 'delivery', 'warranty', 'part_exchange');--> statement-breakpoint
CREATE TABLE "enquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"vehicle_id" uuid,
	"vehicle_title" text,
	"vehicle_registration" text,
	"vehicle_price" integer,
	"vehicle_url" text,
	"type" "enquiry_type" NOT NULL,
	"status" "enquiry_status" DEFAULT 'new' NOT NULL,
	"customer_name" text NOT NULL,
	"email" text,
	"phone" text,
	"preferred_contact" text,
	"message" text NOT NULL,
	"source" text DEFAULT 'website' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enquiries_dealer_status_created_idx" ON "enquiries" USING btree ("dealer_id","status","created_at");--> statement-breakpoint
CREATE INDEX "enquiries_dealer_created_idx" ON "enquiries" USING btree ("dealer_id","created_at");--> statement-breakpoint
CREATE INDEX "enquiries_vehicle_id_idx" ON "enquiries" USING btree ("vehicle_id");