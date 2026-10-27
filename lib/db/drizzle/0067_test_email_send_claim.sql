ALTER TABLE sales_test_email_previews ADD COLUMN reviewed_hash text;
ALTER TABLE sales_test_email_previews ADD COLUMN reviewed_sender text;
ALTER TABLE sales_test_email_previews ADD COLUMN sending_at timestamptz;
