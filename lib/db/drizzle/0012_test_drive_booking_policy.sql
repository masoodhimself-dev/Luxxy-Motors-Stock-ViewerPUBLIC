ALTER TABLE "enquiries" ADD COLUMN "appointment_revision" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "appointment_status" text;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "appointment_duration_minutes" integer;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "appointment_buffer_minutes" integer;
--> statement-breakpoint
UPDATE "enquiries" SET "appointment_status" = 'confirmed', "appointment_duration_minutes" = 30, "appointment_buffer_minutes" = 0 WHERE "type" = 'viewing' AND "appointment_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_appointment_status_check" CHECK ("appointment_status" IS NULL OR "appointment_status" IN ('pending', 'confirmed'));
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_appointment_duration_check" CHECK ("appointment_duration_minutes" IS NULL OR "appointment_duration_minutes" BETWEEN 15 AND 180);
--> statement-breakpoint
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_appointment_buffer_check" CHECK ("appointment_buffer_minutes" IS NULL OR "appointment_buffer_minutes" BETWEEN 0 AND 120);
