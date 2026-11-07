CREATE TABLE "stock_alert_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"alert_id" uuid NOT NULL,
	"digest_date" text NOT NULL,
	"vehicle_ids" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"lease_until" timestamp with time zone,
	"claim_token" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"provider_id" text,
	"payload" text,
	"account_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_alert_deliveries_status_check" CHECK ("stock_alert_deliveries"."status" in ('queued', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "stock_alert_rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_alert_settings" (
	"dealer_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"email" text NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pending_criteria" jsonb,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	CONSTRAINT "stock_alerts_normalised_email_check" CHECK ("stock_alerts"."email" = lower("stock_alerts"."email"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_alert_deliveries_day_uidx" ON "stock_alert_deliveries" USING btree ("dealer_id","alert_id","digest_date");
--> statement-breakpoint
CREATE INDEX "stock_alert_deliveries_due_idx" ON "stock_alert_deliveries" USING btree ("dealer_id","retry_at","lease_until") WHERE "stock_alert_deliveries"."status" in ('queued', 'sending');
--> statement-breakpoint
CREATE INDEX "stock_alert_rate_limits_expiry_idx" ON "stock_alert_rate_limits" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_alerts_dealer_email_uidx" ON "stock_alerts" USING btree ("dealer_id","email");
--> statement-breakpoint
CREATE UNIQUE INDEX "stock_alerts_id_dealer_uidx" ON "stock_alerts" USING btree ("id","dealer_id");
--> statement-breakpoint
CREATE INDEX "stock_alerts_due_idx" ON "stock_alerts" USING btree ("dealer_id","next_check_at") WHERE "stock_alerts"."unsubscribed_at" is null and "stock_alerts"."confirmed_at" is not null;
--> statement-breakpoint
ALTER TABLE "stock_alert_deliveries" ADD CONSTRAINT "stock_alert_deliveries_alert_id_dealer_id_stock_alerts_id_dealer_id_fk" FOREIGN KEY ("alert_id","dealer_id") REFERENCES "public"."stock_alerts"("id","dealer_id") ON DELETE cascade ON UPDATE no action;
