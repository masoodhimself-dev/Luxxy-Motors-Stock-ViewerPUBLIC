ALTER TABLE "enquiries" ADD COLUMN "follow_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "follow_up_note" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "follow_up_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "follow_up_revision" integer DEFAULT 0 NOT NULL;