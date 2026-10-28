-- Retire only namespaces created by the removed practice feature. Real dealers,
-- source vehicles, customer records and their financial ledgers are not targets.
-- Unexpected links abort the migration instead of cascading into live records.
LOCK TABLE sales_test_sessions, sale_workspace, sale_workspace_counters, vehicles IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE
  session_row record;
  related_table record;
  vehicle_reference record;
  has_records boolean;
BEGIN
  FOR session_row IN SELECT * FROM sales_test_sessions ORDER BY id LOOP
    IF session_row.sandbox_dealer_id !~ '^__sales_test__[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
       OR session_row.sandbox_dealer_id = session_row.parent_dealer_id
       OR EXISTS (SELECT 1 FROM dealerships WHERE id = session_row.sandbox_dealer_id) THEN
      RAISE EXCEPTION 'Practice cleanup stopped: namespace isolation could not be verified';
    END IF;

    IF EXISTS (SELECT 1 FROM vehicles WHERE dealer_id = session_row.sandbox_dealer_id
        AND (id IS DISTINCT FROM session_row.vehicle_id OR source IS DISTINCT FROM 'isolated-test'
          OR advert_id IS DISTINCT FROM session_row.id::text))
       OR EXISTS (SELECT 1 FROM vehicles WHERE id = session_row.vehicle_id AND dealer_id <> session_row.sandbox_dealer_id)
       OR EXISTS (SELECT 1 FROM sale_workspace WHERE dealer_id <> session_row.sandbox_dealer_id
          AND state #>> '{draft,vehicleId}' = session_row.vehicle_id::text)
       OR EXISTS (SELECT 1 FROM sale_workspace sw WHERE sw.dealer_id = session_row.sandbox_dealer_id
          AND (sw.state #>> '{draft,vehicleId}' IS DISTINCT FROM session_row.vehicle_id::text
            OR nullif(sw.state #>> '{draft,sourceEnquiryId}', '') IS NOT NULL
            OR nullif(sw.state #>> '{draft,sourceReservationId}', '') IS NOT NULL
            OR sw.state #>> '{draft,customer}' IS DISTINCT FROM coalesce(
              (SELECT te.customer_name FROM sales_test_enquiries te WHERE te.session_id = session_row.id AND te.sale_id = sw.id),
              session_row.customer_name))) THEN
      RAISE EXCEPTION 'Practice cleanup stopped: unexpected vehicle or sale link';
    END IF;

    -- Check all dealership-scoped tables, including tables added in the future.
    FOR related_table IN
      SELECT c.table_schema, c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'dealer_id' AND t.table_type = 'BASE TABLE'
        AND c.table_name NOT IN ('vehicles', 'sale_workspace', 'sale_workspace_counters', 'test_email_settings')
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE dealer_id = $1)', related_table.table_schema, related_table.table_name)
        INTO has_records USING session_row.sandbox_dealer_id;
      IF has_records THEN
        RAISE EXCEPTION 'Practice cleanup stopped: unexpected dealership data in %', related_table.table_name;
      END IF;
    END LOOP;

    -- Even an ON DELETE CASCADE must not silently erase linked real activity.
    FOR vehicle_reference IN
      SELECT DISTINCT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
      FROM pg_catalog.pg_constraint f
      JOIN pg_catalog.pg_class c ON c.oid = f.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN LATERAL unnest(f.conkey, f.confkey) AS keys(child_num, parent_num) ON true
      JOIN pg_catalog.pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = keys.child_num
      JOIN pg_catalog.pg_attribute p ON p.attrelid = f.confrelid AND p.attnum = keys.parent_num
      WHERE f.contype = 'f' AND f.confrelid = 'public.vehicles'::regclass AND p.attname = 'id'
    LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)', vehicle_reference.schema_name, vehicle_reference.table_name, vehicle_reference.column_name)
        INTO has_records USING session_row.vehicle_id;
      IF has_records THEN
        RAISE EXCEPTION 'Practice cleanup stopped: linked vehicle activity in %', vehicle_reference.table_name;
      END IF;
    END LOOP;

    DELETE FROM sale_workspace WHERE dealer_id = session_row.sandbox_dealer_id;
    DELETE FROM sale_workspace_counters WHERE dealer_id = session_row.sandbox_dealer_id;
    DELETE FROM vehicles WHERE dealer_id = session_row.sandbox_dealer_id AND id = session_row.vehicle_id;
  END LOOP;
END $$;
--> statement-breakpoint
DROP TABLE sales_test_enquiry_operations;
--> statement-breakpoint
DROP TABLE sales_test_email_previews;
--> statement-breakpoint
DROP TABLE sales_test_enquiries;
--> statement-breakpoint
DROP TABLE sales_test_settings;
--> statement-breakpoint
DROP TABLE sales_test_sessions;
--> statement-breakpoint
DROP TABLE test_email_settings;
