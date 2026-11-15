CREATE TABLE "mot_stock_renewal_notices" (
	"dealer_id" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"registration" text NOT NULL,
	"expiry_date" date NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" text,
	"account_hash" text,
	"provider_id" text,
	CONSTRAINT "mot_stock_renewal_notices_pk" PRIMARY KEY("dealer_id","vehicle_id","registration","expiry_date"),
	CONSTRAINT "mot_stock_renewal_notices_status_check" CHECK ("mot_stock_renewal_notices"."status" IN ('queued','sending','sent','failed','skipped','unknown')),
	CONSTRAINT "mot_stock_renewal_notices_attempts_check" CHECK ("mot_stock_renewal_notices"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mot_stock_renewal_observations" (
	"dealer_id" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"registration" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"test_date" date,
	"expiry_date" date,
	CONSTRAINT "mot_stock_renewal_observations_dealer_id_vehicle_id_pk" PRIMARY KEY("dealer_id","vehicle_id")
);
--> statement-breakpoint
ALTER TABLE "mot_stock_renewal_notices" ADD CONSTRAINT "mot_stock_renewal_notices_vehicle_fk" FOREIGN KEY ("vehicle_id","dealer_id") REFERENCES "public"."vehicles"("id","dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mot_stock_renewal_observations" ADD CONSTRAINT "mot_stock_renewal_observations_vehicle_fk" FOREIGN KEY ("vehicle_id","dealer_id") REFERENCES "public"."vehicles"("id","dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mot_stock_renewal_notices_due_idx" ON "mot_stock_renewal_notices" USING btree ("dealer_id","next_attempt_at") WHERE "mot_stock_renewal_notices"."status" IN ('queued','sending');