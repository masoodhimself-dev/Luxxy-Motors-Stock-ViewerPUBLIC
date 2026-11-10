CREATE TABLE "cazoo_customer_reply_forwards" (
	"reply_id" uuid PRIMARY KEY NOT NULL,
	"dealer_id" text NOT NULL,
	"lead_receipt_id" uuid NOT NULL,
	"recipient" text NOT NULL,
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
	CONSTRAINT "cazoo_customer_reply_forwards_status_check" CHECK ("cazoo_customer_reply_forwards"."status" in ('pending','sending','sent','failed','unknown','cancelled')),
	CONSTRAINT "cazoo_customer_reply_forwards_attempts_check" CHECK ("cazoo_customer_reply_forwards"."attempts" between 0 and 3),
	CONSTRAINT "cazoo_customer_reply_forwards_payload_check" CHECK (("cazoo_customer_reply_forwards"."payload" is null and "cazoo_customer_reply_forwards"."payload_hash" is null and "cazoo_customer_reply_forwards"."account_hash" is null) or ("cazoo_customer_reply_forwards"."payload" is not null and "cazoo_customer_reply_forwards"."payload_hash" is not null and "cazoo_customer_reply_forwards"."account_hash" is not null))
);
--> statement-breakpoint
ALTER TABLE "cazoo_lead_forwarding_settings" ADD COLUMN "forward_replies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cazoo_customer_reply_forwards" ADD CONSTRAINT "cazoo_customer_reply_forwards_dealer_id_dealerships_id_fk" FOREIGN KEY ("dealer_id") REFERENCES "public"."dealerships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cazoo_customer_reply_forwards_due" ON "cazoo_customer_reply_forwards" USING btree ("next_attempt_at","reply_id") WHERE "cazoo_customer_reply_forwards"."status"='pending';--> statement-breakpoint
CREATE INDEX "cazoo_customer_reply_forwards_expired_lease" ON "cazoo_customer_reply_forwards" USING btree ("lease_until") WHERE "cazoo_customer_reply_forwards"."status"='sending';--> statement-breakpoint
CREATE INDEX "cazoo_customer_reply_forwards_lead" ON "cazoo_customer_reply_forwards" USING btree ("lead_receipt_id","dealer_id");
--> statement-breakpoint
-- Both receipt tables are maintained by SQL migrations outside the Drizzle schema.
ALTER TABLE "enquiry_email_replies" ADD CONSTRAINT "enquiry_email_replies_id_dealer_id_key" UNIQUE ("id","dealer_id");
--> statement-breakpoint
ALTER TABLE "cazoo_customer_reply_forwards" ADD CONSTRAINT "cazoo_customer_reply_forwards_reply_fk" FOREIGN KEY ("reply_id","dealer_id") REFERENCES "enquiry_email_replies"("id","dealer_id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "cazoo_customer_reply_forwards" ADD CONSTRAINT "cazoo_customer_reply_forwards_lead_fk" FOREIGN KEY ("lead_receipt_id","dealer_id") REFERENCES "cazoo_lead_receipts"("id","dealer_id") ON DELETE cascade;
