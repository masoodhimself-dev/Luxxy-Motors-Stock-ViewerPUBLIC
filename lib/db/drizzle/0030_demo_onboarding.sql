CREATE TABLE demo_onboarding_keys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 secret_hash text NOT NULL UNIQUE,
 label text NOT NULL,
 owner_auth_user_id text NOT NULL,
 max_demos integer NOT NULL CHECK (max_demos BETWEEN 1 AND 100),
 max_per_day integer NOT NULL CHECK (max_per_day BETWEEN 1 AND 20),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE demo_onboarding_requests (
 key_id uuid NOT NULL REFERENCES demo_onboarding_keys(id),
 request_id uuid NOT NULL,
 dealer_id text NOT NULL UNIQUE REFERENCES dealer_demos(dealer_id),
 payload_hash text NOT NULL,
 sealed_response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (key_id,request_id)
);
