ALTER TABLE "enquiries" ADD COLUMN "assigned_to_id" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "assigned_to_name" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "call_outcome" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "staff_note" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "attendance" text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "workspace_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_attendance_check" CHECK ("enquiries"."attendance" in ('scheduled', 'arrived', 'completed', 'no_show'));--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_call_outcome_check" CHECK ("enquiries"."call_outcome" is null or "enquiries"."call_outcome" in ('information_given', 'test_drive_booked', 'callback_requested', 'no_answer', 'not_interested'));