ALTER TABLE "enquiries" ADD COLUMN "customer_notification_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "customer_notification_provider_id" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "dealer_notification_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "dealer_notification_provider_id" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "reminder_attempted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "reminder_provider_id" text;--> statement-breakpoint
UPDATE "enquiries"
SET
  "customer_notification_status" = 'not_sent',
  "dealer_notification_status" = 'not_sent'
WHERE
  "customer_notification_status" = 'pending'
  AND "customer_notification_attempted_at" IS NULL
  AND "dealer_notification_status" = 'pending'
  AND "dealer_notification_attempted_at" IS NULL;--> statement-breakpoint
UPDATE "enquiries"
SET "reminder_status" = 'pending'
WHERE
  "type" = 'viewing'
  AND "appointment_at" > now()
  AND "reminder_status" = 'not_scheduled';