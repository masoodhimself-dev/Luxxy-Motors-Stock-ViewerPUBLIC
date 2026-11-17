ALTER TABLE portal_users ADD CONSTRAINT portal_users_dealer_member_key UNIQUE (dealer_id, id);
--> statement-breakpoint
ALTER TABLE portal_users ADD COLUMN legacy_portal_user_id uuid,
  ADD CONSTRAINT portal_users_legacy_member_fk FOREIGN KEY (dealer_id, legacy_portal_user_id) REFERENCES portal_users (dealer_id, id),
  ADD CONSTRAINT portal_users_legacy_shared_check CHECK (legacy_portal_user_id IS NULL OR (shared_staff_identity AND legacy_portal_user_id <> id));
--> statement-breakpoint
CREATE UNIQUE INDEX portal_users_legacy_member_uidx ON portal_users (dealer_id, legacy_portal_user_id) WHERE legacy_portal_user_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE account_invitations ADD COLUMN legacy_portal_user_id uuid,
  ADD CONSTRAINT account_invitations_legacy_member_fk FOREIGN KEY (dealer_id, legacy_portal_user_id) REFERENCES portal_users (dealer_id, id);
