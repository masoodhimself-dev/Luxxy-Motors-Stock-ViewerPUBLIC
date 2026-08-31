CREATE TYPE "public"."sale_actor_type" AS ENUM('staff', 'customer', 'system', 'provider');--> statement-breakpoint
CREATE TYPE "public"."sale_revision_status" AS ENUM('draft', 'active', 'signed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('draft', 'ready', 'signing', 'signed', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."signing_session_status" AS ENUM('pending', 'signed', 'revoked', 'expired');--> statement-breakpoint
CREATE TABLE "acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signing_session_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"code" text NOT NULL,
	"statement" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_vault_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"artifact_type" text DEFAULT 'document_pack' NOT NULL,
	"storage_status" text DEFAULT 'metadata_only' NOT NULL,
	"pack_hash" text NOT NULL,
	"document_hashes" jsonb NOT NULL,
	"manifest" jsonb NOT NULL,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"status" text DEFAULT 'development' NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"total_pence" integer NOT NULL,
	"deposit_pence" integer NOT NULL,
	"balance_pence" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_nonnegative_money_check" CHECK ("invoices"."total_pence" >= 0 and "invoices"."deposit_pence" >= 0 and "invoices"."balance_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_adjustments_amount_check" CHECK ("sale_adjustments"."amount_pence" <> 0)
);
--> statement-breakpoint
CREATE TABLE "sale_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"title" text NOT NULL,
	"template_version" text NOT NULL,
	"sort_order" integer NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"storage_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" "sale_actor_type" NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_fulfilments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" text NOT NULL,
	"target_date" timestamp with time zone,
	"address" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_part_exchanges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"description" text NOT NULL,
	"registration" text,
	"agreed_value_pence" integer NOT NULL,
	"customer_declaration" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_part_exchanges_value_check" CHECK ("sale_part_exchanges"."agreed_value_pence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_pence" integer NOT NULL,
	"method" text,
	"reference" text,
	"status" text DEFAULT 'recorded' NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_payments_amount_check" CHECK ("sale_payments"."amount_pence" > 0)
);
--> statement-breakpoint
CREATE TABLE "sale_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"status" "sale_revision_status" DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"document_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pack_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sale_warranties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"name" text NOT NULL,
	"duration_months" integer,
	"price_pence" integer DEFAULT 0 NOT NULL,
	"terms" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_warranties_nonnegative_check" CHECK ("sale_warranties"."price_pence" >= 0 and ("sale_warranties"."duration_months" is null or "sale_warranties"."duration_months" > 0))
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_id" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"enquiry_id" uuid,
	"status" "sale_status" DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'GBP' NOT NULL,
	"agreed_price_pence" integer NOT NULL,
	"deposit_pence" integer DEFAULT 0 NOT NULL,
	"balance_pence" integer NOT NULL,
	"mileage_at_sale" integer,
	"disclosure_notes" text,
	"internal_notes" text,
	"customer_snapshot" jsonb,
	"vehicle_snapshot" jsonb,
	"signed_revision_id" uuid,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_nonnegative_money_check" CHECK ("sales"."agreed_price_pence" >= 0 and "sales"."deposit_pence" >= 0 and "sales"."balance_pence" >= 0),
	CONSTRAINT "sales_balance_matches_check" CHECK ("sales"."balance_pence" = "sales"."agreed_price_pence" - "sales"."deposit_pence")
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signing_session_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"signature_type" text DEFAULT 'demo' NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text,
	"signature_hash" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"intended_customer_email" text,
	"provider_kind" text DEFAULT 'demo' NOT NULL,
	"provider_request_id" text,
	"status" "signing_session_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"signed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_signing_session_id_signing_sessions_id_fk" FOREIGN KEY ("signing_session_id") REFERENCES "public"."signing_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_revision_id_sale_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."sale_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_vault_artifacts" ADD CONSTRAINT "deal_vault_artifacts_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_vault_artifacts" ADD CONSTRAINT "deal_vault_artifacts_revision_id_sale_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."sale_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_adjustments" ADD CONSTRAINT "sale_adjustments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_documents" ADD CONSTRAINT "sale_documents_revision_id_sale_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."sale_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_events" ADD CONSTRAINT "sale_events_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_fulfilments" ADD CONSTRAINT "sale_fulfilments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_part_exchanges" ADD CONSTRAINT "sale_part_exchanges_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_revisions" ADD CONSTRAINT "sale_revisions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_warranties" ADD CONSTRAINT "sale_warranties_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_enquiry_id_enquiries_id_fk" FOREIGN KEY ("enquiry_id") REFERENCES "public"."enquiries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_signing_session_id_signing_sessions_id_fk" FOREIGN KEY ("signing_session_id") REFERENCES "public"."signing_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_revision_id_sale_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."sale_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_sessions" ADD CONSTRAINT "signing_sessions_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_sessions" ADD CONSTRAINT "signing_sessions_revision_id_sale_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."sale_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acknowledgements_session_code_uidx" ON "acknowledgements" USING btree ("signing_session_id","code");--> statement-breakpoint
CREATE INDEX "acknowledgements_revision_idx" ON "acknowledgements" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "customers_dealer_created_idx" ON "customers" USING btree ("dealer_id","created_at");--> statement-breakpoint
CREATE INDEX "customers_dealer_email_idx" ON "customers" USING btree ("dealer_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_vault_artifacts_sale_revision_uidx" ON "deal_vault_artifacts" USING btree ("sale_id","revision_id");--> statement-breakpoint
CREATE INDEX "deal_vault_artifacts_sale_idx" ON "deal_vault_artifacts" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_sale_uidx" ON "invoices" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uidx" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "sale_adjustments_sale_idx" ON "sale_adjustments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_documents_revision_order_uidx" ON "sale_documents" USING btree ("revision_id","sort_order");--> statement-breakpoint
CREATE INDEX "sale_documents_revision_idx" ON "sale_documents" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "sale_events_sale_created_idx" ON "sale_events" USING btree ("sale_id","created_at");--> statement-breakpoint
CREATE INDEX "sale_events_type_created_idx" ON "sale_events" USING btree ("event_type","created_at");--> statement-breakpoint
CREATE INDEX "sale_fulfilments_sale_idx" ON "sale_fulfilments" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_part_exchanges_sale_idx" ON "sale_part_exchanges" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_revisions_sale_number_uidx" ON "sale_revisions" USING btree ("sale_id","revision_number");--> statement-breakpoint
CREATE INDEX "sale_revisions_sale_status_idx" ON "sale_revisions" USING btree ("sale_id","status");--> statement-breakpoint
CREATE INDEX "sale_warranties_sale_idx" ON "sale_warranties" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sales_dealer_status_created_idx" ON "sales" USING btree ("dealer_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sales_vehicle_idx" ON "sales" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signatures_session_uidx" ON "signatures" USING btree ("signing_session_id");--> statement-breakpoint
CREATE INDEX "signatures_revision_idx" ON "signatures" USING btree ("revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signing_sessions_token_hash_uidx" ON "signing_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "signing_sessions_sale_status_idx" ON "signing_sessions" USING btree ("sale_id","status");--> statement-breakpoint
CREATE INDEX "signing_sessions_expiry_idx" ON "signing_sessions" USING btree ("status","expires_at");