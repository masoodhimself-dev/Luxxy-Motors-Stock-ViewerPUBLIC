CREATE TABLE sold_vehicle_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id text NOT NULL,
  sale_id uuid NOT NULL REFERENCES sale_workspace(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL,
  enquiry_id uuid NOT NULL,
  related_enquiry_ids jsonb NOT NULL,
  kind text NOT NULL CHECK (kind IN ('appointment','interest')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','not_needed')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  cancelled_at timestamptz,
  contacted_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('phone','email','not_needed')),
  email_id uuid,
  note text,
  updated_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (vehicle_id,dealer_id) REFERENCES vehicles(id,dealer_id) ON DELETE CASCADE,
  FOREIGN KEY (enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX sold_vehicle_follow_ups_sale_customer_uidx ON sold_vehicle_follow_ups(dealer_id,sale_id,enquiry_id);
--> statement-breakpoint
CREATE INDEX sold_vehicle_follow_ups_home_idx ON sold_vehicle_follow_ups(dealer_id,status,created_at);
