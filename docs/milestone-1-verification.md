# Milestone 1: backend and migration repairs

Implemented and verified locally on 16 September 2026. Production Replit hosting,
databases and secrets were not accessed or modified. Replit integrations remain.

## Changes

- Restored sales creation, checklist updates, preparation, signing, revocation,
  final checks and completion. Removed duplicate handlers. The three previously
  missing staff endpoints are implemented and protected by staff authorization.
- Preserved lead-to-sale associations, transaction boundaries, immutable revision
  hashes, signing-token hashes, checklist evidence and vehicle locks.
- Explicit deposit confirmation records the remaining offline deposit once.
  Concurrent signing/completion and repeated completion do not duplicate records.
  This records an offline payment; it does not charge a payment processor.
- Enquiries and their initial lead/timeline now commit in the same transaction.
- Corrected lead response adapters and correlated SQL so updates return the
  documented portal payload and linked sales/contact timestamps are visible.
  Manual lead capture now requires an email address or phone number.
- Added staff authorization to contact-history reads; public contact recording
  remains available. Added regression coverage for both behaviours.
- Added migration 0011 and its generated Drizzle snapshot/journal. This reconciles
  portal users, enquiry events, seven enquiry columns and associated indexes.
- Removed automatic forced schema synchronization from the merge hook and removed
  the push-force package script. Added the explicit migration command and guidance.
- API tests require an explicit loopback luxxy_test_* database. They never fall
  back to DATABASE_URL and block external fetches, using synthetic auth credentials.
- Corrected three pre-existing sandbox prop errors so the whole workspace builds.

## Verification

- `PORT=4175 BASE_PATH=/ NODE_ENV=production pnpm run build`: passed, including
  shared-library, API, customer frontend, scripts and sandbox typechecks, and
  production frontend/API/sandbox builds.
- `pnpm --filter @workspace/api-server test` with an explicitly selected disposable
  local PostgreSQL 16 database: 35 tests passed (2 safety, 12 stock, 10 sales,
  9 lead, 2 portal tests).
- `pnpm --filter @workspace/api-server test:migrations` on a second empty local
  database: passed. Replayed all 12 migrations, preserved synthetic stock and
  enquiry data across 0011, checked all 27 tables and their columns/indexes,
  verified cancelled booking slot reuse and duplicate booking rejection, and
  verified that rerunning the migration runner changes no migration history.
- Offline Drizzle generation after reconciliation: no schema changes remaining.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @workspace/luxxy-motors test`:
  all 117 frontend tests passed. The flag avoids Node 25's native web-storage
  behaviour conflicting with the jsdom setup.
- `git diff --check`: passed.

Tests used Node 25.5 and pnpm 11.19 locally. The Replit configuration still specifies
Node 24; a pinned runtime and CI matrix are recommended next.

## Remaining limitations

No failing checks remain in the commands above. Vite still reports a tooltip
source-map warning and a main JavaScript chunk over 500 kB; both builds succeed.
Customer browser flows with a real Clerk tenant and real email delivery were not
exercised. The e-sign provider, invoice and document-vault flows remain explicitly
labelled development demonstrations, not a completed production document service.

Earlier uncommitted showroom/mobile and local-preview changes were left in place
and are not part of these commits. Frontend validation used that current workspace.

## Data impact and rollout

No production migration was applied. Migration 0011 is schema-additive except for
replacing the appointment uniqueness index with the cancellation-aware predicate.
On an older schema it backfills newly added enquiry references. It does not delete
or rewrite stock, customer, lead or sale records. Adding columns and creating
indexes takes database locks, and existing pushed schemas may already contain some
of these objects. Review a restored database and its migration journal before any
production application; see `lib/db/MIGRATIONS.md`.

After deployment, the repaired routes will create and transition records when
explicitly invoked. Existing signing and checklist evidence remains subject to
validation; expired/revoked links cannot sign, and missing signer email is rejected
when the session specifies an intended email. Existing incomplete deals may require
fresh checklist confirmation/preparation.

The next milestone should pin the local runtime and package manager, document
configuration, and run these checks in CI with disposable PostgreSQL. Then rehearse
a production-schema baseline on a restored copy before any hosting or integration
migration is considered.
