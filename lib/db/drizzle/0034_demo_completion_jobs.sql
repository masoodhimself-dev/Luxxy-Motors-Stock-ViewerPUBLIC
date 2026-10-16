ALTER TABLE dealer_demos ADD COLUMN onboarding_patch_hash text;
ALTER TABLE dealer_demos ADD COLUMN onboarding_patch_revision integer;
CREATE TABLE demo_completion_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 dealer_id text NOT NULL UNIQUE REFERENCES dealer_demos(dealer_id),
 key_id uuid NOT NULL REFERENCES demo_onboarding_keys(id),
 run_id text NOT NULL,
 status text NOT NULL DEFAULT 'queued',
 stage text NOT NULL DEFAULT 'import-check',
 attempts integer NOT NULL DEFAULT 0,
 delivery_checks integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 history jsonb NOT NULL DEFAULT '[]'::jsonb,
 error text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demo_completion_jobs_due_idx ON demo_completion_jobs(next_attempt_at) WHERE status IN ('queued','running');
