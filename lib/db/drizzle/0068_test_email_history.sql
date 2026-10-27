ALTER TABLE sales_test_email_previews ADD COLUMN enquiry_id uuid REFERENCES sales_test_enquiries(id) ON DELETE CASCADE;
ALTER TABLE sales_test_email_previews ADD COLUMN sent_at timestamptz;
ALTER TABLE sales_test_email_previews ADD COLUMN reviewed_subject text;
ALTER TABLE sales_test_email_previews ADD COLUMN reviewed_text text;
CREATE INDEX sales_test_email_history_idx ON sales_test_email_previews (session_id,enquiry_id,sent_at) WHERE status='sent';
