CREATE TABLE IF NOT EXISTS vehicle_public_links (
 code text PRIMARY KEY CHECK (code ~ '^[a-z0-9]{8}$'),
 vehicle_id uuid REFERENCES vehicles(id) ON DELETE SET NULL,
 dealer_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_public_links_vehicle_uidx ON vehicle_public_links(vehicle_id);
CREATE INDEX IF NOT EXISTS vehicle_public_links_dealer_idx ON vehicle_public_links(dealer_id);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION ensure_vehicle_public_link(target_vehicle uuid, target_dealer text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE assigned text;
BEGIN
 LOOP
  SELECT code INTO assigned FROM vehicle_public_links WHERE vehicle_id = target_vehicle;
  IF assigned IS NOT NULL THEN RETURN assigned; END IF;
  assigned := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  INSERT INTO vehicle_public_links(code, vehicle_id, dealer_id)
   VALUES (assigned, target_vehicle, target_dealer) ON CONFLICT DO NOTHING;
  IF FOUND THEN RETURN assigned; END IF;
 END LOOP;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assign_vehicle_public_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM ensure_vehicle_public_link(NEW.id, NEW.dealer_id);
 RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS vehicles_assign_public_link ON vehicles;
CREATE TRIGGER vehicles_assign_public_link AFTER INSERT ON vehicles
 FOR EACH ROW EXECUTE FUNCTION assign_vehicle_public_link();
--> statement-breakpoint
SELECT ensure_vehicle_public_link(id, dealer_id) FROM vehicles;
