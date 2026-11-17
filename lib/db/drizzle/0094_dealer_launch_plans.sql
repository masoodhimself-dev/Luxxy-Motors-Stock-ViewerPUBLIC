ALTER TABLE dealerships ADD COLUMN plan text NOT NULL DEFAULT 'full_portal'
  CHECK (plan IN ('full_portal', 'website_only'));
--> statement-breakpoint
ALTER TABLE dealerships
  ADD COLUMN enquiry_email text,
  ADD COLUMN onboarding_required boolean NOT NULL DEFAULT false,
  ADD COLUMN onboarding_proof jsonb,
  ADD CONSTRAINT dealership_website_enquiry_email_check
    CHECK (plan <> 'website_only' OR nullif(trim(enquiry_email), '') IS NOT NULL);
--> statement-breakpoint
ALTER TABLE portal_users ADD COLUMN shared_staff_identity boolean NOT NULL DEFAULT false;
