-- Operator-approved public contact information; fill only empty Luxxy fields.
-- Preserve both versions so the ordinary settings history can restore this change.
INSERT INTO dealer_settings_versions (dealer_id, revision, config, published_at, published_by, action)
SELECT dealer_id, revision, config, updated_at, 'Initial settings', 'initial'
FROM dealer_settings WHERE dealer_id = 'luxxy-motors'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
WITH changed AS (
  UPDATE dealer_settings
  SET config = jsonb_set(config, '{contact}', COALESCE(config->'contact', '{}'::jsonb) ||
    CASE WHEN COALESCE(trim(config#>>'{contact,phone}'), '') = '' THEN '{"phone":"07388831790"}'::jsonb ELSE '{}'::jsonb END ||
    CASE WHEN COALESCE(trim(config#>>'{contact,whatsapp}'), '') = '' THEN '{"whatsapp":"447388831790"}'::jsonb ELSE '{}'::jsonb END),
    revision = revision + 1, updated_at = NOW()
  WHERE dealer_id = 'luxxy-motors' AND
    (COALESCE(trim(config#>>'{contact,phone}'), '') = '' OR COALESCE(trim(config#>>'{contact,whatsapp}'), '') = '')
  RETURNING dealer_id, revision, config, updated_at
)
INSERT INTO dealer_settings_versions (dealer_id, revision, config, published_at, published_by, action)
SELECT dealer_id, revision, config, updated_at, 'Operator-approved contact setup', 'publish' FROM changed;
