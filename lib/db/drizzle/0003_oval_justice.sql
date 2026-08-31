ALTER TABLE "enquiries" ADD COLUMN "customer_notification_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "customer_notification_error" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "customer_notification_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "dealer_notification_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "dealer_notification_error" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "dealer_notification_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "reminder_status" text DEFAULT 'not_scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "reminder_error" text;--> statement-breakpoint
ALTER TABLE "enquiries" ADD COLUMN "reminder_sent_at" timestamp with time zone;