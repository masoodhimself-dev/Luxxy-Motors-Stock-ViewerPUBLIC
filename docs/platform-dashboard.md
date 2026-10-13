# Dealer Platform management console

The shared application serves `/platform` on `PLATFORM_ADMIN_HOST`. The name is deliberately neutral while the operator chooses a platform brand and domain. Visiting `/` on that administration host redirects to `/platform`; other unknown website hosts still receive 421. Clerk modal sign-in returns to `/platform`. Platform routes have no customer dealership header, footer, saved-car tray or chat and do not mount dealer stock/settings providers.

## Available workflows

- Overview: actual registered dealers, active/draft counts and dealers requiring setup or a successful stock connection.
- Dealerships: search name, ID, domain or retailer reference and filter status.
- Add dealership: business → HTTPS website → owner → marketplace/source → review. The internal ID is generated from the name, editable under Advanced, and immutable after creation. Creation remains transactional and creates an inactive draft, domain token, owner membership and neutral dealer settings.
- Owner: use the current authenticated administrator as this dealer's owner, resolve an existing Clerk account by email, or enter an existing user ID. Exactly one option is accepted. Email lookup failure cannot leave a partial dealership. This does not grant platform administrator rights.
- Dealer workspace: launch checklist, domain aliases/DNS tokens, staff membership summary, stock connection metadata and latest 30 submissions.
- Domain verification and activation remain separate; activation requires canonical domain verification. Render custom-domain DNS/TLS setup is a manual operator step. Suspend/reactivate requires a confirmation and uses the existing protected status endpoint.
- Import activity displays actual database records; latest successful import is separate from latest failed/quarantined submission. Operational queries fetch one latest record per dealer and bounded recent history rather than loading full snapshots.

## Protected API additions

`GET /api/platform/overview` returns registry metadata, verified-domain flags, active credential counts, latest import, last successful import and 30 recent import records.

`GET /api/platform/dealers/:id/workspace` returns that registered dealer, domain verification records, staff summaries, 30 recent import summaries and credential IDs/timestamps/revocation flags. It never returns key hashes, raw stock snapshots or private provider settings.

`POST /api/platform/dealers` additionally accepts one of `useMyAccount: true`, `ownerEmail` or existing `ownerAuthUserId`. Existing clients supplying the user ID continue to work. Approved admin/import hosts cannot be registered as dealer domains or aliases.

All routes retain approved-host, Clerk administrator allowlist and same-origin write checks. No new database migration or external email is introduced.

## Boundaries

- The dashboard does not create or resume Grok agents, provision Render domains, configure TLS or change worker schedules.
- New-user invitation/acceptance, platform billing/tier enforcement, cross-dealer editing of private integration settings and a general operator audit log are follow-up workflows, not presented as working controls. Import activity is not a general audit log.
- Brand/email/payment settings and detailed staff editing remain in each dealer portal with normal staff authorization. A platform administrator is not automatically a dealer staff member.
- No platform domain has been selected. Changing the public hostname requires Render DNS/TLS, `PLATFORM_ADMIN_HOST`, approved Clerk configuration and any operator/import host references to be reviewed together. Do not invent a domain or silently rename the existing API host.
- The loopback development adapter uses fictional drafts and disables real domain activation and credential operations. It is never imported by production.

## Verification

`pnpm --filter @workspace/api-server run test:platform` uses an isolated PGlite database and synthetic Clerk identities to exercise access checks, reserved-host rejection, owner selection, atomic duplicates, domain activation protection and metadata redaction. This is not a live Clerk invitation test.

Frontend unit tests cover denied access, guided creation, search and platform sign-in return. Playwright checks at 390, 820 and 1440 pixels use fictional API data and block real writes, including DNS review and onboarding. Existing two-dealer HTTP isolation tests remain applicable.

## Saved dealer onboarding checklist

Each dealership's Setup tab contains 26 grouped operator checks for business/access, website/domain, stock, email/payments, staff workflows and launch approval. Statuses are Pending, Complete and Not applicable; the latter requires a reason. Notes (up to 1,000 characters), last editor's Clerk ID and saved time persist in the dealership's private `onboarding_checklist` JSONB column. An item-level PATCH merges atomically, preserving other items during concurrent edits. Only authorised platform administrators on the approved administration host can change progress.

Progress appears on dealership cards and the Setup tab. System-derived domain/credential/import checks remain separate from manual confirmations. Checklist completion does not activate a dealer, start a bot, enable payments or prove a manually recorded test. Existing dealers start with pending manual checks, rather than fabricated completion history. Migration `0027_dealer_onboarding` adds the column without changing stock or dealer status.
