CREATE TABLE "cazoo_lead_forwarding_settings" (
	"dealer_id" text PRIMARY KEY NOT NULL,
	"recipient" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "cazoo_forwarding_recipient_check" CHECK (("cazoo_lead_forwarding_settings"."recipient" is null or length("cazoo_lead_forwarding_settings"."recipient") between 3 and 254) and (not "cazoo_lead_forwarding_settings"."enabled" or "cazoo_lead_forwarding_settings"."recipient" is not null))
);
--> statement-breakpoint
CREATE TABLE "cazoo_lead_forwards" (
	"receipt_id" uuid PRIMARY KEY NOT NULL,
	"dealer_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text,
	"body" text,
	"payload" text,
	"payload_hash" text,
	"account_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retry_deadline" timestamp with time zone NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"provider_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "cazoo_lead_forwards_status_check" CHECK ("cazoo_lead_forwards"."status" in ('pending','sending','sent','failed','unknown','cancelled')),
	CONSTRAINT "cazoo_lead_forwards_attempts_check" CHECK ("cazoo_lead_forwards"."attempts" between 0 and 3),
	CONSTRAINT "cazoo_lead_forwards_payload_check" CHECK (("cazoo_lead_forwards"."payload" is null and "cazoo_lead_forwards"."payload_hash" is null and "cazoo_lead_forwards"."account_hash" is null) or ("cazoo_lead_forwards"."payload" is not null and "cazoo_lead_forwards"."payload_hash" is not null and "cazoo_lead_forwards"."account_hash" is not null))
);
--> statement-breakpoint
ALTER TABLE "cazoo_lead_forwarding_settings" ADD CONSTRAINT "cazoo_lead_forwarding_settings_dealer_id_dealerships_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cazoo_lead_forwards" ADD CONSTRAINT "cazoo_lead_forwards_dealer_id_dealerships_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cazoo_lead_forwards_dedupe" ON "cazoo_lead_forwards" USING btree ("dealer_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "cazoo_lead_forwards_due" ON "cazoo_lead_forwards" USING btree ("next_attempt_at","receipt_id") WHERE "cazoo_lead_forwards"."status"='pending';--> statement-breakpoint
CREATE INDEX "cazoo_lead_forwards_expired_lease" ON "cazoo_lead_forwards" USING btree ("lease_until") WHERE "cazoo_lead_forwards"."status"='sending';
--> statement-breakpoint
-- The Cazoo receipt table is maintained by SQL migrations, outside the Drizzle schema.
ALTER TABLE "cazoo_lead_receipts" ADD CONSTRAINT "cazoo_lead_receipts_id_dealer_id_key" UNIQUE ("id","dealer_id");
--> statement-breakpoint
ALTER TABLE "cazoo_lead_forwards" ADD CONSTRAINT "cazoo_lead_forwards_receipt_fk" FOREIGN KEY ("receipt_id","dealer_id") REFERENCES "cazoo_lead_receipts"("id","dealer_id") ON DELETE cascade;
