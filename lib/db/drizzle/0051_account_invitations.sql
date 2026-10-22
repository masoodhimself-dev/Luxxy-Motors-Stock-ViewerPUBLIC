CREATE TABLE account_invitations (
 id uuid PRIMARY KEY, dealer_id text NOT NULL REFERENCES dealerships(id) ON DELETE CASCADE,
 email text NOT NULL, role text NOT NULL CHECK(role IN ('owner','salesperson','accounts')),
 token_hash text NOT NULL UNIQUE, created_by text NOT NULL, issuer_kind text NOT NULL CHECK(issuer_kind IN ('platform','staff')),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 accepted_at timestamptz, accepted_by text, revoked_at timestamptz,
 delivery_status text NOT NULL DEFAULT 'pending' CHECK(delivery_status IN ('pending','sending','sent','failed','unknown')),
 delivery_attempt uuid NOT NULL, send_count integer NOT NULL DEFAULT 1 CHECK(send_count BETWEEN 1 AND 5), last_sent_at timestamptz, provider_id text,
 CONSTRAINT account_invitations_email_lowercase CHECK(email=lower(email)), CONSTRAINT account_invitations_acceptance CHECK((accepted_at IS NULL)=(accepted_by IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX account_invitations_pending_email ON account_invitations(dealer_id,email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
--> statement-breakpoint
CREATE INDEX account_invitations_dealer_created ON account_invitations(dealer_id,created_at DESC);
