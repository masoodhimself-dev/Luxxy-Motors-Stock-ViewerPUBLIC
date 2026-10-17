CREATE TABLE staff_ai_draft_generations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dealer_id text NOT NULL,
 enquiry_id uuid NOT NULL,
 auth_user_id text NOT NULL,
 request_id uuid NOT NULL,
 base_revision integer NOT NULL CHECK(base_revision>=0),
 base_draft_version integer NOT NULL CHECK(base_draft_version>=0),
 facts_hash text NOT NULL,
 model text NOT NULL,
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','succeeded','failed','unknown','stale')),
 reserved_micro_usd integer NOT NULL CHECK(reserved_micro_usd>0),
 day_key text NOT NULL,
 month_key text NOT NULL,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 failure_code text,
 UNIQUE(dealer_id,request_id)
);
--> statement-breakpoint
CREATE INDEX staff_ai_draft_generations_dealer_day_idx ON staff_ai_draft_generations(dealer_id,day_key);
--> statement-breakpoint
CREATE INDEX staff_ai_draft_generations_month_idx ON staff_ai_draft_generations(month_key,dealer_id);
--> statement-breakpoint
ALTER TABLE enquiry_email_drafts ADD COLUMN ai_generation_id uuid REFERENCES staff_ai_draft_generations(id);
