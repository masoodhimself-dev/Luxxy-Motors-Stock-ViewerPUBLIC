-- One bounded, fixed-content test per demo. No customer messages or credentials.
CREATE TABLE demo_onboarding_completion (
 dealer_id text PRIMARY KEY REFERENCES dealer_demos(dealer_id),
 key_id uuid NOT NULL REFERENCES demo_onboarding_keys(id),
 recipient text NOT NULL,
 provider_id text,
 email_status text NOT NULL DEFAULT 'pending',
 created_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz,
 baseline_run_id text,
 completed_at timestamptz
);
