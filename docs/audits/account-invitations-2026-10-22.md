# Dealership owner and staff invitations — 22 October 2026

## Delivery status
Implemented on `codex/dealer-owner-staff-invitations`. Not deployed. No real invitations sent or production memberships changed.

## Operator and owner flow
1. Platform → Add dealership defaults to **Invite owner by email**. Enter the confirmed owner email alongside the existing dealership details.
2. Creating the draft dealership sends an invitation using the platform email sender. Existing operator setup access is retained. No platform administrator access is granted to the invitee.
3. The recipient opens the central platform `/join` page, creates an account or signs in using Clerk, verifies the invited email, and explicitly accepts.
4. An active dealership opens its portal. A draft dealership explains that its website is still being prepared.
5. Platform → dealership → Staff also supports invitation status, resend and cancel.
6. Owners use Settings → Team & access to invite Salesperson, Accounts or Owner accounts. Existing staff roles and disable controls remain available.

## Staff-access correction
The legacy staff upsert now targets the actual tenant-scoped unique constraint `(dealer_id, auth_user_id)`, rather than the obsolete global `auth_user_id` conflict target. Staff invitations no longer require registration beforehand.

## Security and boundaries
- Seven-day links, cryptographically random 256-bit capabilities, only SHA-256 token hashes persisted.
- Fragment token captured before the authentication provider renders, then removed from the address bar. Session storage supports returning after sign-in. The token is sent only in a dedicated API header, never authentication redirect query strings.
- Verified email must match the invitation. Pending invitations grant no access. Acceptance is atomic and idempotent for the same active membership.
- Tenant membership is scoped to one dealer; platform administrator permissions remain separate.
- Resend invalidates the previous link. Cancellation, expiry, wrong account, wrong host, inactive inviter, disabled membership, suspended dealer and unconverted demo checks prevent acceptance.
- No implicit role elevation or reactivation of existing staff. Last-owner safeguards remain unchanged.
- Maximum five sends per invitation, one-minute resend interval and fifty new invitations per dealer per day.
- Private/no-store/no-referrer/noindex handling for join capabilities. Public preview discloses masked email only.
- Provider acceptance is labelled sent, not delivered. Failed/unknown sends remain visible for explicit recovery.

## API
| Method | Path | Access |
|---|---|---|
| GET, POST | `/api/platform/dealers/:id/invitations` | Platform administrator; owner invitations only |
| POST | `/api/platform/dealers/:id/invitations/:invitationId/resend` | Platform administrator |
| POST | `/api/platform/dealers/:id/invitations/:invitationId/cancel` | Platform administrator |
| GET, POST | `/api/staff/team/invitations` | Dealership owner |
| POST | `/api/staff/team/invitations/:invitationId/resend` | Dealership owner; staff-issued invitation |
| POST | `/api/staff/team/invitations/:invitationId/cancel` | Dealership owner; staff-issued invitation |
| GET | `/api/account-invitations/preview` | Valid token and original host |
| POST | `/api/account-invitations/accept` | Valid token, authenticated verified matching email and original host |

## Rollout prerequisites
- Apply additive migration `0051_account_invitations.sql` before the new API runs. The existing Render predeploy migration command will apply it on an approved deployment.
- Existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and `PLATFORM_ADMIN_HOST` must be correct. No new client secrets. Optional `ACCOUNT_INVITATIONS_ENABLED=false` disables sending.
- Invitations deliberately use the platform sender, independently of dealer customer-email delivery switches and feature settings.
- Confirm the first dealership and owner email before sending a real invitation. Test actual delivery and a fresh Clerk signup after deployment; those were not exercised against production.
- Roll back application code if needed; leave the additive table in place. Code rollback does not remove accepted memberships. Revoke access explicitly if necessary.

## Verification
- Frontend suite: **1,844 tests across 176 files passed**.
- Final token-hardening targeted frontend rerun: **49 tests passed**.
- Invitation HTTP/database suite: **10 tests passed**, using isolated PGlite and mocked Clerk/Resend.
- Platform integration regression: passed. Staff/improvement regression scripts: **42 tests passed**. Email regression checks: **20 tests passed**.
- Workspace typechecking and production build passed after the final changes. Existing bundle-size warnings remain.
- Browser tested fictional owner and staff invite → preview → explicit acceptance; platform acceptance status refresh; draft website readiness. Responsive checks at 390×844, 820×1180 and 1440×1000, with no page-level horizontal overflow.
- Local preview invitations never send emails or change real account access, and are labelled fictional.
- Real Clerk signup/email delivery and physical-device testing remain unverified until deployment. No changes to live Luxxy or Paramount stock updates, booking rules, sales calculations, issued invoices or customer email delivery behaviour.

## Test maintenance
Three sales follow-up test files used date-sensitive October fixtures; the test clock is now fixed so unrelated tests do not expire as the calendar advances. An existing platform SEO assertion was aligned with the unchanged current title. No corresponding sales or SEO production behaviour changed.
