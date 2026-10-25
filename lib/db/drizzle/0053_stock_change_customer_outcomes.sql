CREATE UNIQUE INDEX stock_change_tasks_id_dealer_uidx ON stock_change_tasks(id,dealer_id);
--> statement-breakpoint
CREATE TABLE stock_change_settings (
 dealer_id text PRIMARY KEY,
 minimum_reduction integer NOT NULL DEFAULT 100,
 contact_interval_days integer NOT NULL DEFAULT 7,
 revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT stock_change_settings_values_check CHECK (minimum_reduction BETWEEN 0 AND 1000000 AND contact_interval_days BETWEEN 0 AND 365 AND revision>=0)
);
--> statement-breakpoint
CREATE TABLE stock_change_customer_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id text NOT NULL, task_id uuid NOT NULL, enquiry_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending', revision integer NOT NULL DEFAULT 0, channel text, follow_up_at timestamptz, note text,
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,dealer_id) REFERENCES stock_change_tasks(id,dealer_id) ON DELETE CASCADE,
 FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE,
 CONSTRAINT stock_change_customer_outcomes_values_check CHECK (status IN ('pending','contacted','not_needed','follow_up') AND revision>=0 AND (channel IS NULL OR channel IN ('call','email','whatsapp')) AND ((status='follow_up' AND follow_up_at IS NOT NULL) OR (status<>'follow_up' AND follow_up_at IS NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_change_customer_outcomes_customer_uidx ON stock_change_customer_outcomes(dealer_id,task_id,enquiry_id);
--> statement-breakpoint
CREATE INDEX stock_change_customer_outcomes_follow_up_idx ON stock_change_customer_outcomes(dealer_id,status,follow_up_at);
--> statement-breakpoint
CREATE TABLE stock_change_contact_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id text NOT NULL, task_id uuid NOT NULL, vehicle_id uuid NOT NULL, enquiry_id uuid NOT NULL,
 event_key text NOT NULL, channel text NOT NULL CHECK(channel IN ('call','email','whatsapp')), customer_email text, customer_phone text, contacted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(task_id,dealer_id) REFERENCES stock_change_tasks(id,dealer_id) ON DELETE CASCADE,
 FOREIGN KEY(vehicle_id,dealer_id) REFERENCES vehicles(id,dealer_id) ON DELETE CASCADE,
 FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX stock_change_contact_events_key_uidx ON stock_change_contact_events(dealer_id,event_key);
--> statement-breakpoint
CREATE INDEX stock_change_contact_events_customer_idx ON stock_change_contact_events(dealer_id,vehicle_id,contacted_at DESC);
