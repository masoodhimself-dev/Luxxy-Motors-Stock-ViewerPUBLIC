CREATE TYPE "public"."sale_checklist_code" AS ENUM('customer_confirmed', 'vehicle_confirmed', 'price_confirmed', 'disclosure_confirmed', 'mileage_confirmed', 'warranty_confirmed', 'fulfilment_confirmed', 'part_exchange_confirmed', 'deposit_confirmed', 'documents_generated');--> statement-breakpoint
CREATE TYPE "public"."sale_checklist_status" AS ENUM('pending', 'complete', 'not_applicable', 'invalidated');--> statement-breakpoint
CREATE TABLE "sale_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"revision_id" uuid,
	"code" "sale_checklist_code" NOT NULL,
	"status" "sale_checklist_status" DEFAULT 'pending' NOT NULL,
	"completed_by" text,
	"completed_at" timestamp with time zone,
	"evidence_hash" text,
	"notes" text,
	"evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_checklist_items" ADD CONSTRAINT "sale_checklist_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_checklist_items" ADD CONSTRAINT "sale_checklist_items_revision_id_sale_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."sale_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_checklist_sale_code_uidx" ON "sale_checklist_items" USING btree ("sale_id","code");--> statement-breakpoint
CREATE INDEX "sale_checklist_sale_status_idx" ON "sale_checklist_items" USING btree ("sale_id","status");