ALTER TABLE enquiries ADD COLUMN archived_at timestamptz,
 ADD COLUMN archive_delete_at timestamptz,
 ADD COLUMN archive_review_at timestamptz,
 ADD COLUMN archive_hold_reason text;
--> statement-breakpoint
ALTER TABLE enquiries ADD CONSTRAINT enquiries_archive_dates_check CHECK (
 (archived_at IS NULL AND archive_delete_at IS NULL AND archive_review_at IS NULL AND archive_hold_reason IS NULL)
 OR (archived_at IS NOT NULL AND archive_delete_at IS NOT NULL AND archive_delete_at >= archived_at)
);
--> statement-breakpoint
CREATE INDEX enquiries_archive_due_idx ON enquiries(dealer_id,archive_review_at) WHERE archived_at IS NOT NULL;
--> statement-breakpoint
ALTER TABLE ai_assistance_requests ADD COLUMN context_audit jsonb;
--> statement-breakpoint
CREATE INDEX ai_assistance_enquiry_audit ON ai_assistance_requests(dealer_id,(context_audit->>'enquiryId'),created_at DESC) WHERE context_audit IS NOT NULL;
