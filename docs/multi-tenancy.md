# Multi-dealership foundation and rollout

Status: implemented and tested locally on `codex/multi-tenant-foundation`; not enabled on Render. No live database migration, domain change or Grok scheduler change has been performed.

## Architecture

One application and shared PostgreSQL database. Each dealership has an immutable ID, registered domains, canonical HTTPS origin, status, one marketplace and exact retailer reference. Core business records retain existing dealer_id ownership. A request-scoped AsyncLocalStorage context replaces global dealership selection throughout active routes, private settings, link generation and background reservation expiry.

In shared mode, unknown, unverified, draft or suspended domains fail with HTTP 421. Browser-supplied dealer IDs and X-Forwarded-Host do not select a dealership. Render must pass the original Host header. Each dealer's custom domains also need to be added to the shared Render service and configured at its DNS provider; database registration alone does not provision certificates. Verify this edge behavior on staging before launch.

Website settings and business data are scoped by dealership. Private settings are AES-256-GCM encrypted database rows with per-dealer queues and optimistic revision checks. Shared deployments do not fall back to global Resend credentials. Different dealers can configure different Resend and Stripe credentials. Background expiry runs in each active dealership's context. Public URLs and emails use that dealership's canonical origin. Shared-mode frontend branding falls back to neutral content while settings load.

Staff use a shared Clerk application with explicit per-dealer membership. A Clerk identity can belong to multiple dealerships. The old first-user owner claim and global portal machine token are disabled in shared mode. Platform administrator access is an explicit Clerk user-ID allowlist and approved administrator host, separate from the dealer owner role. Verify Clerk custom-domain/redirect configuration for the intended production deployment; local tests use synthetic identities and do not validate live Clerk sessions.

## Separate Grok connections

Each dealer has a distinct authenticated route on the shared API origin:

- POST https://APPROVED_IMPORT_HOST/api/stock/imports/DEALER_ID/grok
- Content-Type: application/json
- x-stock-import-secret: runtime-injected per-dealer secret

Keep schemaVersion 1 and complete snapshots. The key, path dealership and configured retailer must agree. Keys are high-entropy random values stored only as SHA-256 hashes; issuing a key returns its raw value once to the authenticated operator, for direct secure worker configuration. Rotation/revocation does not require another server. A dealer's key cannot import another dealer's stock. Source marketplace and state/price/missing-advert safeguards remain. UUID run IDs must be unique for each new snapshot.

The legacy unscoped route/environment secret remains available only in single-dealer mode. Existing deployment behavior is retained while MULTI_TENANT_ENABLED is false. Do not enable shared mode until registry, domains, memberships and credentials are prepared.

## Operator console and API

Frontend route: /platform on PLATFORM_ADMIN_HOST, with Clerk sign-in.

Protected /api/platform endpoints:

- GET /dealers; POST /dealers (id, name, canonicalOrigin, platform, retailerId, sourceUrl, ownerAuthUserId).
- GET /dealers/:id/domains; POST /dealers/:id/domains with hostname.
- POST /dealers/:id/verify-domain with hostname: checks the generated DNS TXT ownership token.
- PUT /dealers/:id/status with draft, active or suspended; canonical domain verification is required for activation.
- POST /dealers/:id/import-key: one-time raw secret and endpoint path. Never paste it into chat/logs.
- DELETE /dealers/:id/import-key/:keyId: revoke that dealer's key.

All these POST/PUT/DELETE operations are writes, not dry runs. Unknown administrators are denied. Domain ownership verification is separate from Render DNS/TLS provisioning. The console supports draft creation and canonical-domain verification; alias/key management currently uses the protected API.

## Deployment prerequisites

Prepared `render.multi-tenant-staging.yaml`: one paid shared web service and a separate paid PostgreSQL instance, not one pair per dealership. Database-backed private settings avoid requiring a persistent file disk. Billable resource creation requires operator cost approval.

1. Create isolated shared staging. Configure Clerk keys securely, PLATFORM_ADMIN_USER_IDS, PLATFORM_ADMIN_HOST, STOCK_IMPORT_API_HOST and a random 32-byte INTEGRATIONS_ENCRYPTION_KEY. Set both MULTI_TENANT_ENABLED and VITE_MULTI_TENANT_ENABLED to true only on this new environment. Do not inherit existing worker secrets.
2. Apply reviewed migrations to that new empty database, including 0021_dealership_tenancy. Never apply these automatically to an existing live database. Migration changes the staff identity uniqueness index to (dealer_id,auth_user_id), without deleting records.
3. Create two test dealerships, seed explicit owners, verify DNS ownership, add both domains to Render and check TLS/Host routing. Configure website details and approved legal terms before exercising real booking/sale flows.
4. Issue two distinct keys directly to secure worker configuration. Test full imports, price changes, retries, failures, source mismatch, missing adverts, dealer overrides and cross-dealer access.
5. Test real Clerk owner/salesperson/accounts sessions, callbacks, bookings, calendar, chat, reservations, sale documents and emails on both domains. Keep providers disabled or controlled until their test/live behavior is agreed. The existing production payment adapter rejects Stripe test mode when NODE_ENV is production; this is not changed here.
6. Review backups, rollback, isolation/security and realistic load before migrating the existing dealership or onboarding paying dealers. The current implementation enforces application-level dealer scoping; PostgreSQL row-level security is not added in this milestone.
7. Import existing dealership metadata/data deliberately, preserving dealer IDs, linked records and private settings. Update each Grok worker only after its own connection test succeeds.

## Verification performed

In-memory PostgreSQL engine (PGlite), not a mocked SQL implementation: all committed SQL migrations run on a fresh isolated database; two fake dealerships use separate domains and import credentials. HTTP tests cover incorrect domains/keys, same advert IDs producing different vehicle records, identical retries, cross-dealer vehicle lookups, enquiry ownership and branding. Staff-membership checks reject uninvited users and users belonging only to another dealership. Encrypted settings and canonical links remain separate. A real database-backed draft sale, deposit/receipt, final payment and completion change only dealer A's stock; dealer B remains unaffected. Concurrent context tests verify no identity mixing.

Frontend regression: 312 existing tests passed with NODE_OPTIONS=--no-experimental-webstorage on the local Node 25 runtime. An existing expired-chat test fixture was corrected to give the new chat a fresh ID rather than reusing the expired ID. Two additional platform-console tests cover access denial and draft/DNS instructions (314 frontend tests total). Typechecks and builds pass. This is not a claim that Render DNS/TLS, live Clerk or every end-to-end provider workflow has been verified.


## Local stock-import contract verification — 9 October 2026

These changes are local only; no Render deployment, live migration or Grok activation was performed.

- Import errors echo `runId` and `retailerId` where the request contains them (otherwise null), with explicit status and structured errors.
- Invalid credentials return 401; an active credential belonging to another dealer returns 403. Import-host mismatches return 421.
- Shared imports require every car to declare `sourceExtras.sourcePlatform`. Marketplace/retailer semantic mismatches return 422 rejected; malformed schema remains 400 rejected.
- Completed identical retries return 200 replayed even after the freshness window or a newer applied snapshot. Authentication, current connection and payload matching still apply. Comparison uses canonical JSON SHA-256, not raw-byte hashing; whitespace/object key order do not create conflicts.
- Under a per-dealer transaction lock, new snapshots older than the greatest completed `scrapedAt` return 409 rejected with `superseded_snapshot`. Freshness checks follow replay detection. Equal timestamps are allowed; workers must retain their generation-order safeguards.
- Stale new runs and incomplete/drop snapshots return 422 quarantined. Conflicting run-ID reuse returns 409 rejected. Quarantined runs remain blocked.
- Oversized request bodies return 413 rejected with `payload_too_large` rather than the former generic 500. Malformed JSON cannot supply a trustworthy run ID and returns null identity.
- The existing bounded server-error retry policy still applies; Retry-After provisioning for capacity/rate limiting is not implemented here.

Verification: the in-memory PostgreSQL-compatible two-dealer HTTP suite exercises invalid/wrong-dealer keys, host/retailer/marketplace rejection, complete imports, price updates, conflict/replay handling, 48-hour replay, stale new runs, delayed older snapshots, independent vehicle/settings/enquiry/staff access, and preservation of reserved/sold status through imports. Stock-feed regression tests and API TypeScript checks also pass. This is not yet a real Render/Grok connection test.
