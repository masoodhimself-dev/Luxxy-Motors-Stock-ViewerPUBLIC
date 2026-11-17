ALTER TABLE cazoo_lead_receipts ALTER COLUMN draft_status SET DEFAULT 'skipped';
--> statement-breakpoint
UPDATE cazoo_lead_receipts
SET draft_status='skipped', draft_lease_until=NULL
WHERE draft_status<>'skipped' OR draft_lease_until IS NOT NULL;
--> statement-breakpoint
-- Retain the contents for audit. Staff-authored or staff-edited drafts keep their status.
UPDATE enquiry_email_drafts
SET status='discarded', version=version+1, updated_at=now()
WHERE status='draft' AND source='ai' AND updated_by='cazoo-draft-worker' AND send_request_id IS NULL;
--> statement-breakpoint
-- Stop queued automatic replies, including scheduled retries. An earlier attempt
-- can have reached the provider, so only a first attempt can be marked unsent.
WITH stopped AS (
  UPDATE email_outbox
  SET status=CASE WHEN attempts=0 THEN 'failed' ELSE 'unknown' END,
      error_code='cazoo_automatic_reply_retired', lease_token=NULL, lease_until=NULL,
      finished_at=now(), updated_at=now()
  WHERE kind='staff' AND status='queued' AND validation?'cazooFirstReply'
  RETURNING delivery_id, dealer_id, enquiry_id, status
)
UPDATE enquiry_emails m
SET status=s.status, finished_at=now(),
    error=CASE WHEN s.status='failed'
      THEN 'This automatic Cazoo reply was stopped. Reply from the enquiry.'
      ELSE 'An earlier automatic Cazoo reply may have been sent. Check the conversation and Resend before replying.'
    END
FROM stopped s
WHERE m.id=s.delivery_id AND m.dealer_id=s.dealer_id AND m.enquiry_id=s.enquiry_id AND m.status='sending';
