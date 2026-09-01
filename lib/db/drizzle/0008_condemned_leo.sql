CREATE TYPE "public"."customer_intake_status" AS ENUM('pending', 'completed', 'expired');--> statement-breakpoint
CREATE TABLE "customer_intake_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" "customer_intake_status" DEFAULT 'pending' NOT NULL,
	"customer_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_intake_sessions" ADD CONSTRAINT "customer_intake_sessions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_intake_sessions" ADD CONSTRAINT "customer_intake_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_intake_token_hash_uidx" ON "customer_intake_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "customer_intake_dealer_status_created_idx" ON "customer_intake_sessions" USING btree ("dealer_id","status","created_at");--> statement-breakpoint
CREATE INDEX "customer_intake_expiry_idx" ON "customer_intake_sessions" USING btree ("status","expires_at");