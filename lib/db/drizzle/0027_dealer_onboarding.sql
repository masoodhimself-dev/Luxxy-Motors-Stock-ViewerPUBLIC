ALTER TABLE dealerships ADD COLUMN onboarding_checklist jsonb NOT NULL DEFAULT '{}'::jsonb;
