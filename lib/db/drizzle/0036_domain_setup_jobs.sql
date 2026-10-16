CREATE TABLE domain_setup_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id text NOT NULL REFERENCES dealerships(id),
  hostname text NOT NULL UNIQUE REFERENCES dealer_domains(hostname),
  hostnames jsonb NOT NULL DEFAULT '[]'::jsonb,
  render_service_id text NOT NULL,
  render_target text NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'preflight',
  attempts integer NOT NULL DEFAULT 0,
  error text,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domain_setup_jobs_due_idx ON domain_setup_jobs(next_attempt_at) WHERE status IN ('queued','running','waiting');
