CREATE UNIQUE INDEX "enquiries_id_dealer_id_unique" ON "enquiries" USING btree ("id","dealer_id");
--> statement-breakpoint
CREATE TABLE "enquiry_emails" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dealer_id" text NOT NULL,
	"enquiry_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"status" text NOT NULL,
	"recipient" text NOT NULL,
	"subject" text NOT NULL,
	"message" text NOT NULL,
	"photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider_id" text,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "enquiry_emails_status_check" CHECK ("enquiry_emails"."status" in ('sending','sent','failed','unknown'))
);
--> statement-breakpoint
ALTER TABLE "enquiry_emails" ADD CONSTRAINT "enquiry_emails_enquiry_id_dealer_id_enquiries_id_dealer_id_fk" FOREIGN KEY ("enquiry_id","dealer_id") REFERENCES "public"."enquiries"("id","dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enquiry_emails_request_unique" ON "enquiry_emails" USING btree ("dealer_id","enquiry_id","request_id");--> statement-breakpoint
CREATE INDEX "enquiry_emails_history_idx" ON "enquiry_emails" USING btree ("dealer_id","enquiry_id","created_at");
