CREATE TABLE "demo_stock_collection_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by" text NOT NULL,
	"source_url" text NOT NULL,
	"retailer_id" text NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"payload_hash" text,
	"dealer_id" text,
	"dealer_name" text,
	"received" integer,
	"error" text,
	CONSTRAINT "demo_stock_collection_jobs_status_check" CHECK ("demo_stock_collection_jobs"."status" in ('collecting', 'ready', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "demo_stock_collection_jobs" ADD CONSTRAINT "demo_stock_collection_jobs_dealer_id_dealerships_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealerships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_stock_collection_jobs_active_idx" ON "demo_stock_collection_jobs" USING btree ("retailer_id","expires_at") WHERE "demo_stock_collection_jobs"."status" = 'collecting';