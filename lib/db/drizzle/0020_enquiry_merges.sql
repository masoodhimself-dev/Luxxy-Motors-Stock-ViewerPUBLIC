-- Staff case grouping preserves every original record and its customer links.
ALTER TABLE "enquiries" ADD COLUMN "merged_into_id" uuid;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "merged_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "merged_by" text;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_merge_parent_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."enquiries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_merge_parent_check" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");
--> statement-breakpoint
CREATE INDEX "enquiries_dealer_merge_parent_idx" ON "enquiries" USING btree ("dealer_id", "merged_into_id");
--> statement-breakpoint
ALTER TYPE public.enquiry_event_kind ADD VALUE IF NOT EXISTS 'records_merged';
