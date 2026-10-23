-- Reply addresses are capabilities. They never appear in public APIs or request logs.
CREATE TABLE enquiry_email_reply_routes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dealer_id text NOT NULL, enquiry_id uuid NOT NULL,
 send_key text NOT NULL, reply_address text NOT NULL UNIQUE, recipient text NOT NULL,
 in_reply_to text, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(dealer_id,send_key), UNIQUE(id,dealer_id),
 FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE enquiry_email_replies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider_id uuid NOT NULL UNIQUE,
 route_id uuid NOT NULL, dealer_id text NOT NULL, enquiry_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','received','review')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 sender text, subject text, message text, message_id text, attachment_names jsonb NOT NULL DEFAULT '[]'::jsonb,
 error_code text, received_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz, resolved_by text,
 FOREIGN KEY(route_id,dealer_id) REFERENCES enquiry_email_reply_routes(id,dealer_id) ON DELETE CASCADE,
 FOREIGN KEY(enquiry_id,dealer_id) REFERENCES enquiries(id,dealer_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX enquiry_email_replies_history ON enquiry_email_replies(dealer_id,enquiry_id,received_at DESC,id);
CREATE INDEX enquiry_email_replies_due ON enquiry_email_replies(next_attempt_at) WHERE status IN ('pending','processing');
CREATE INDEX enquiry_email_replies_attention ON enquiry_email_replies(dealer_id,enquiry_id) WHERE resolved_at IS NULL;
