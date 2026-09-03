CREATE TYPE "public"."lead_actor_type" AS ENUM('staff', 'customer', 'system');--> statement-breakpoint
CREATE TYPE "public"."lead_deposit_method" AS ENUM('cash', 'card_machine', 'bank_transfer', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_event_type" AS ENUM('lead_created', 'enquiry_received', 'call_logged', 'message_logged', 'email_logged', 'visit_logged', 'note_added', 'viewing_booked', 'stage_changed', 'owner_assigned', 'next_action_set', 'deposit_recorded', 'outcome_recorded', 'sale_created');--> statement-breakpoint
CREATE TYPE "public"."lead_outcome" AS ENUM('won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('website_form', 'phone', 'whatsapp', 'walk_in', 'marketplace', 'social');--> statement-breakpoint
CREATE TYPE "public"."lead_stage" AS ENUM('new', 'qualifying', 'viewing_booked', 'offer', 'reserved', 'sale_agreed', 'collected', 'won', 'lost');--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" "lead_event_type" NOT NULL,
	"actor_type" "lead_actor_type" NOT NULL,
	"actor" text,
	"body" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"enquiry_id" uuid,
	"vehicle_id" uuid,
	"vehicle_title" text,
	"vehicle_registration" text,
	"vehicle_price" integer,
	"vehicle_url" text,
	"stage" "lead_stage" DEFAULT 'new' NOT NULL,
	"source" "lead_source" NOT NULL,
	"owner" text,
	"customer_name" text NOT NULL,
	"email" text,
	"phone" text,
	"preferred_contact" text,
	"summary" text,
	"next_action" text,
	"next_action_due_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"outcome" "lead_outcome",
	"outcome_reason" text,
	"closed_at" timestamp with time zone,
	"deposit_pence" integer DEFAULT 0 NOT NULL,
	"deposit_method" "lead_deposit_method",
	"deposit_reference" text,
	"deposit_taken_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_closure_check" CHECK ((
        "leads"."stage" in ('won', 'lost')
        and "leads"."outcome" is not null
        and "leads"."outcome"::text = "leads"."stage"::text
        and "leads"."outcome_reason" is not null
        and length(btrim("leads"."outcome_reason")) > 0
        and "leads"."closed_at" is not null
      ) or (
        "leads"."stage" not in ('won', 'lost')
        and "leads"."outcome" is null
        and "leads"."outcome_reason" is null
        and "leads"."closed_at" is null
      )),
	CONSTRAINT "leads_deposit_check" CHECK ((
        "leads"."deposit_pence" = 0
        and "leads"."deposit_method" is null
        and "leads"."deposit_taken_at" is null
      ) or (
        "leads"."deposit_pence" > 0
        and "leads"."deposit_method" is not null
        and "leads"."deposit_taken_at" is not null
      ))
);
--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "lead_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_events_lead_occurred_idx" ON "lead_events" USING btree ("lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lead_events_lead_created_idx" ON "lead_events" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_events_type_occurred_idx" ON "lead_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_enquiry_uidx" ON "leads" USING btree ("enquiry_id");--> statement-breakpoint
CREATE INDEX "leads_dealer_stage_created_idx" ON "leads" USING btree ("dealer_id","stage","created_at");--> statement-breakpoint
CREATE INDEX "leads_dealer_created_idx" ON "leads" USING btree ("dealer_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_dealer_next_action_idx" ON "leads" USING btree ("dealer_id","next_action_due_at");--> statement-breakpoint
CREATE INDEX "leads_dealer_owner_idx" ON "leads" USING btree ("dealer_id","owner");--> statement-breakpoint
CREATE INDEX "leads_vehicle_idx" ON "leads" USING btree ("vehicle_id");--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sales_lead_idx" ON "sales" USING btree ("lead_id");