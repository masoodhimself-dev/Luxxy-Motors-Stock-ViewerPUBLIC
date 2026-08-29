ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_run_dealer_fk";
--> statement-breakpoint
ALTER TABLE "vehicle_changes" DROP CONSTRAINT "vehicle_changes_run_dealer_fk";
--> statement-breakpoint
ALTER TABLE "vehicle_changes" DROP CONSTRAINT "vehicle_changes_run_integration_fk";
--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_run_dealer_fk" FOREIGN KEY ("import_run_id","tenant_dealer_id") REFERENCES "public"."stock_import_runs"("id","tenant_dealer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_run_dealer_fk" FOREIGN KEY ("import_run_id","tenant_dealer_id") REFERENCES "public"."stock_import_runs"("id","tenant_dealer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_changes" ADD CONSTRAINT "vehicle_changes_run_integration_fk" FOREIGN KEY ("import_run_id","tenant_dealer_id","dealer_integration_id") REFERENCES "public"."stock_import_runs"("id","tenant_dealer_id","dealer_integration_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "public"."prevent_owned_stock_import_run_delete"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM vehicles
    WHERE import_run_id = OLD.id AND tenant_dealer_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM vehicle_changes
    WHERE import_run_id = OLD.id AND tenant_dealer_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'foreign key constraint: owned stock import run is still referenced'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "stock_import_runs_prevent_owned_delete"
BEFORE DELETE ON "stock_import_runs"
FOR EACH ROW EXECUTE FUNCTION "public"."prevent_owned_stock_import_run_delete"();