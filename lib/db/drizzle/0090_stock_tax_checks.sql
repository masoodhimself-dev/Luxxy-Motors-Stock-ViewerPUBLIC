CREATE TABLE "stock_tax_checks" (
	"dealer_id" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"registration" text NOT NULL,
	"tax_status" text,
	"due_date" text,
	"checked_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"error_code" text,
	CONSTRAINT "stock_tax_checks_dealer_id_vehicle_id_pk" PRIMARY KEY("dealer_id","vehicle_id"),
	CONSTRAINT "stock_tax_checks_status_check" CHECK ("stock_tax_checks"."tax_status" IN ('Taxed','Untaxed','SORN','Not Taxed for on Road Use'))
);
--> statement-breakpoint
ALTER TABLE "stock_tax_checks" ADD CONSTRAINT "stock_tax_checks_vehicle_id_dealer_id_vehicles_id_dealer_id_fk" FOREIGN KEY ("vehicle_id","dealer_id") REFERENCES "public"."vehicles"("id","dealer_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_tax_checks_due_idx" ON "stock_tax_checks" USING btree ("next_attempt_at","dealer_id","vehicle_id");