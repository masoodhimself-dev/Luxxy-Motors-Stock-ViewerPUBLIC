CREATE TABLE enquiry_email_drafts (
  dealer_id text NOT NULL,
  enquiry_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sending','sent','unknown','discarded')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','template','ai')),
  content jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  send_request_id uuid,
  PRIMARY KEY (dealer_id,enquiry_id),
  FOREIGN KEY (enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX enquiry_email_drafts_queue_idx ON enquiry_email_drafts(dealer_id,status,updated_at DESC);
