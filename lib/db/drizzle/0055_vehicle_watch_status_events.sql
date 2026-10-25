-- Observe existing stock transitions without changing any reservation, sale,
-- payment or booking rule. No email is sent by this trigger.
CREATE INDEX vehicle_watch_events_vehicle_idx ON vehicle_watch_events(dealer_id,vehicle_id,status);
--> statement-breakpoint
CREATE FUNCTION record_vehicle_watch_status_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_kind text;
  event_time timestamptz := clock_timestamp();
  platform text;
BEGIN
  IF NEW.inventory_status IS NOT DISTINCT FROM OLD.inventory_status THEN RETURN NEW; END IF;

  UPDATE vehicle_watch_events SET status='superseded',revision=revision+1,updated_at=event_time
    WHERE dealer_id=NEW.dealer_id AND vehicle_id=NEW.id AND status='open';

  SELECT stock_platform INTO platform FROM dealerships WHERE id=NEW.dealer_id;
  IF NEW.archived_at IS NOT NULL OR NEW.source IS DISTINCT FROM platform THEN RETURN NEW; END IF;
  IF NEW.inventory_status='sold' THEN
    -- Stock-feed absence changes source_status only. This branch requires an
    -- actual confirmed inventory-status write by an existing sales workflow.
    event_kind := 'sold';
  ELSIF NEW.source_status='live' AND NEW.missing_count=0
      AND NOT (NEW.price_review_required AND coalesce(NEW.website_price_override,NEW.source_price) IS NULL) THEN
    IF OLD.inventory_status='available' AND NEW.inventory_status='reserved' THEN
      event_kind := 'reserved';
    ELSIF OLD.inventory_status='reserved' AND NEW.inventory_status='available' THEN
      event_kind := 'available_again';
    END IF;
  END IF;
  IF event_kind IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM vehicle_watch_settings WHERE dealer_id=NEW.dealer_id AND enabled=false) THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM vehicle_watches WHERE dealer_id=NEW.dealer_id AND vehicle_id=NEW.id
      AND status='active' AND email_verified_at IS NOT NULL AND email_verified_at<=event_time) THEN RETURN NEW; END IF;

  INSERT INTO vehicle_watch_events(dealer_id,vehicle_id,kind,change_key,previous_price,current_price,previous_status,current_status,occurred_at,created_at,updated_at)
    VALUES(NEW.dealer_id,NEW.id,event_kind,'status:'||gen_random_uuid()::text,
      coalesce(OLD.website_price_override,OLD.source_price),coalesce(NEW.website_price_override,NEW.source_price),
      OLD.inventory_status::text,NEW.inventory_status::text,event_time,event_time,event_time);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER vehicle_watch_status_event AFTER UPDATE OF inventory_status ON vehicles
  FOR EACH ROW EXECUTE FUNCTION record_vehicle_watch_status_event();
