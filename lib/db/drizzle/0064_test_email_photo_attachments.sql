ALTER TABLE sales_test_email_previews ADD COLUMN photo_attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
