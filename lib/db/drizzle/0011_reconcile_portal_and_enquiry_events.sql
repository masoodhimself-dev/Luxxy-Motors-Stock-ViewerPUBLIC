CREATE TYPE "public"."enquiry_event_actor" AS ENUM('customer', 'dealer', 'system');--> statement-breakpoint
CREATE TYPE "public"."enquiry_event_kind" AS ENUM('enquiry_received', 'viewing_booked', 'viewing_rescheduled', 'viewing_cancelled', 'call_intent', 'whatsapp_intent');--> statement-breakpoint
CREATE TABLE "enquiry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"enquiry_id" uuid,
	"vehicle_id" uuid,
	"vehicle_title" text,
	"vehicle_url" text,
	"kind" "enquiry_event_kind" NOT NULL,
	"actor" "enquiry_event_actor" DEFAULT 'customer' NOT NULL,
	"summary" text NOT NULL,
	"detail" jsonb,
	"visitor_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portal_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"auth_user_id" text NOT NULL,
	"email" text,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "enquiries_dealer_appointment_uidx";--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "reference" text DEFAULT upper(substr(md5(random()::text), 1, 4) || '-' || substr(md5(random()::text), 1, 4)) NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "part_exchange_registration" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "part_exchange_mileage" integer;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "part_exchange_condition" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "appointment_cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "manage_token_hash" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "visitor_id" text;--> statement-breakpoint
ALTER TABLE "enquiry_events" ADD CONSTRAINT "enquiry_events_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enquiry_events" ADD CONSTRAINT "enquiry_events_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enquiry_events_dealer_occurred_idx" ON "enquiry_events" USING btree ("dealer_id","occurred_at");--> statement-breakpoint
CREATE INDEX "enquiry_events_enquiry_occurred_idx" ON "enquiry_events" USING btree ("enquiry_id","occurred_at");--> statement-breakpoint
CREATE INDEX "enquiry_events_dealer_visitor_idx" ON "enquiry_events" USING btree ("dealer_id","visitor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "enquiry_events_vehicle_idx" ON "enquiry_events" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portal_users_auth_user_uidx" ON "portal_users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "portal_users_dealer_idx" ON "portal_users" USING btree ("dealer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_dealer_reference_uidx" ON "enquiries" USING btree ("dealer_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_manage_token_hash_uidx" ON "enquiries" USING btree ("manage_token_hash");--> statement-breakpoint
CREATE INDEX "enquiries_dealer_visitor_idx" ON "enquiries" USING btree ("dealer_id","visitor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enquiries_dealer_appointment_uidx" ON "enquiries" USING btree ("dealer_id","appointment_at") WHERE appointment_cancelled_at is null;