ALTER TABLE "integration_collector_credentials" DROP CONSTRAINT "integration_collector_credentials_hash_not_empty_check";--> statement-breakpoint
ALTER TABLE "stock_import_runs" ADD CONSTRAINT "stock_import_runs_id_tenant_dealer_integration_unique" UNIQUE("id","tenant_dealer_id","dealer_integration_id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_id_tenant_dealer_integration_unique" UNIQUE("id","tenant_dealer_id","dealer_integration_id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_run_dealer_fk" FOREIGN KEY ("import_run_id","tenant_dealer_id") REFERENCES "public"."stock_import_runs"("id","tenant_dealer_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_images" ADD CONSTRAINT "vehicle_images_vehicle_integration_fk" FOREIGN KEY ("vehicle_id","tenant_dealer_id","dealer_integration_id") REFERENCES "public"."vehicles"("id","tenant_dealer_id","dealer_integration_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_vehicle_integration_fk" FOREIGN KEY ("vehicle_id","tenant_dealer_id","dealer_integration_id") REFERENCES "public"."vehicles"("id","tenant_dealer_id","dealer_integration_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_run_integration_fk" FOREIGN KEY ("import_run_id","tenant_dealer_id","dealer_integration_id") REFERENCES "public"."stock_import_runs"("id","tenant_dealer_id","dealer_integration_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_collector_credentials" ADD CONSTRAINT "integration_collector_credentials_verifier_format_check" CHECK ((
      "integration_collector_credentials"."hash_algorithm" = 'scrypt'
      and "integration_collector_credentials"."verifier_hash" ~ '^[a-f0-9]{128}$'
      and "integration_collector_credentials"."verifier_salt" ~ '^[a-f0-9]{32}$'
    ) or (
      "integration_collector_credentials"."hash_algorithm" = 'argon2id'
      and "integration_collector_credentials"."verifier_hash" like '$argon2id$%'
      and length("integration_collector_credentials"."verifier_salt") >= 16
    ));