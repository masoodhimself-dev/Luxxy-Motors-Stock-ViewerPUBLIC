CREATE TABLE vehicle_watch_settings(dealer_id text PRIMARY KEY,enabled boolean NOT NULL DEFAULT true,revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),updated_at timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE vehicle_watches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dealer_id text NOT NULL,vehicle_id uuid NOT NULL,email text NOT NULL CHECK(email=lower(email)),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','stopped')),email_verified_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),stopped_at timestamptz,FOREIGN KEY(vehicle_id,dealer_id) REFERENCES vehicles(id,dealer_id) ON DELETE CASCADE);
--> statement-breakpoint
CREATE UNIQUE INDEX vehicle_watches_dealer_vehicle_email_uidx ON vehicle_watches(dealer_id,vehicle_id,email);
CREATE UNIQUE INDEX vehicle_watches_id_dealer_uidx ON vehicle_watches(id,dealer_id);
CREATE INDEX vehicle_watches_active_idx ON vehicle_watches(dealer_id,vehicle_id,status);
--> statement-breakpoint
CREATE TABLE vehicle_watch_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dealer_id text NOT NULL,email text NOT NULL,watch_id uuid,purpose text NOT NULL CHECK(purpose IN ('verify','manage')),token_hash text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(watch_id,dealer_id) REFERENCES vehicle_watches(id,dealer_id) ON DELETE CASCADE);
CREATE INDEX vehicle_watch_tokens_lookup_idx ON vehicle_watch_tokens(dealer_id,email,purpose);
--> statement-breakpoint
CREATE TABLE vehicle_watch_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dealer_id text NOT NULL,vehicle_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('price_drop','reserved','available_again','sold')),change_key text NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','dismissed','superseded')),previous_price integer,current_price integer,previous_status text,current_status text,revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),occurred_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(vehicle_id,dealer_id) REFERENCES vehicles(id,dealer_id) ON DELETE CASCADE);
CREATE UNIQUE INDEX vehicle_watch_events_key_uidx ON vehicle_watch_events(dealer_id,change_key);
CREATE UNIQUE INDEX vehicle_watch_events_id_dealer_uidx ON vehicle_watch_events(id,dealer_id);
CREATE INDEX vehicle_watch_events_home_idx ON vehicle_watch_events(dealer_id,status,created_at DESC);
--> statement-breakpoint
CREATE TABLE vehicle_watch_deliveries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dealer_id text NOT NULL,event_id uuid NOT NULL,watch_id uuid NOT NULL,request_id uuid NOT NULL,status text NOT NULL CHECK(status IN ('processing','sent','failed','uncertain','skipped')),subject text NOT NULL,message text NOT NULL,provider_id text,error text,sent_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(event_id,dealer_id) REFERENCES vehicle_watch_events(id,dealer_id) ON DELETE CASCADE,FOREIGN KEY(watch_id,dealer_id) REFERENCES vehicle_watches(id,dealer_id) ON DELETE CASCADE);
CREATE UNIQUE INDEX vehicle_watch_deliveries_event_watch_uidx ON vehicle_watch_deliveries(dealer_id,event_id,watch_id);
--> statement-breakpoint
CREATE TABLE vehicle_watch_rate_limits(key text PRIMARY KEY,count integer NOT NULL,expires_at timestamptz NOT NULL);
--> statement-breakpoint
CREATE TABLE vehicle_watch_reply_routes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),dealer_id text NOT NULL,watch_id uuid NOT NULL,delivery_id uuid NOT NULL,reply_address text NOT NULL UNIQUE,recipient text NOT NULL,enquiry_id uuid,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(watch_id,dealer_id) REFERENCES vehicle_watches(id,dealer_id) ON DELETE CASCADE);
CREATE UNIQUE INDEX vehicle_watch_reply_routes_delivery_uidx ON vehicle_watch_reply_routes(dealer_id,delivery_id);
--> statement-breakpoint
CREATE TABLE vehicle_watch_reply_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider_id uuid NOT NULL UNIQUE,route_id uuid NOT NULL REFERENCES vehicle_watch_reply_routes(id) ON DELETE CASCADE,dealer_id text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','received','review')),attempts integer NOT NULL DEFAULT 0,lease_until timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX vehicle_watch_reply_receipts_due_idx ON vehicle_watch_reply_receipts(status,next_attempt_at);
