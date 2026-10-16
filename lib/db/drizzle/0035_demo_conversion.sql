ALTER TABLE dealer_demos ADD COLUMN converted_at timestamptz;
ALTER TABLE dealer_demos ADD COLUMN converted_by text;
ALTER TABLE dealer_demos ADD COLUMN conversion_receipt jsonb;
