# Independent deployment

The application no longer requires a Replit account, runtime, connector, router,
or database. Use Node.js 24, pnpm 11.19.0 and an independently provisioned PostgreSQL
16+ database. Each dealership requires a separate deployment, database, credentials
and settings. Hosting is not provisioned by these files.

## Build and run

1. Copy `.env.example` to `.env` at the repository root for local development, or
   configure its variables through the host's secret manager. Supply real values
   only for the intended environment. Never use a production database for tests.
2. Run `pnpm install --frozen-lockfile` then `pnpm build`.
3. Run `pnpm start` from the repository root. One Express process serves `/api`,
   `/share`, static website files and SPA routes. `PORT` defaults to 8080; managed
   hosts may supply their own port. Use `BASE_PATH=/` for this single-service setup.
4. Configure the host's health check as `/api/healthz`. Put HTTPS termination in
   front of the Node service. Set `PUBLIC_SITE_URL` to the public HTTPS origin.

The frontend's `VITE_*` settings are embedded at build time, so rebuild after
changing the Clerk publishable key. Only public values belong in `VITE_*`.
Backend secrets are read at runtime. The root `.env` is loaded by `pnpm start`,
`pnpm dev:api` and Vite; the host environment takes precedence.

For full local development, build the API, run `pnpm dev:api`, and in another
terminal run `pnpm --filter @workspace/luxxy-motors dev`. Vite defaults to port
4175 and proxies `/api` and `/share` to localhost:8080. The fixture-only design
preview remains available with `pnpm dev:preview`; never deploy that preview.

For a local-network preview, set `LUXXY_PREVIEW_LAN_HOST` to the Mac’s current private network IP and bind Vite to all interfaces. From `artifacts/luxxy-motors`, run:

```sh
LUXXY_PREVIEW_LAN_HOST=192.168.1.103 PORT=4175 BASE_PATH=/ pnpm exec vite --config vite.preview.config.ts --host 0.0.0.0 --port 4175
```

Replace the IP if the network changes. Open that same IP and port on devices connected to the local network. Binding Vite alone does not enable preview API access; the LAN host setting is also required.

## Database

No migration runs during installation, build or startup. A fresh database needs
reviewed migrations applied separately by an operator: follow `lib/db/MIGRATIONS.md`.
Existing data is not copied or modified by this change. Do not point a new staging
service at the existing production database: startup includes the notification
worker and lead backfill. Preserve `SESSION_SECRET` when deliberately migrating
existing records so existing customer capability links remain valid.

## Authentication

Create/manage your own Clerk application through the Clerk dashboard, configure
its deployment domain and allowed redirects, and set matching frontend/backend
keys. Existing staff authorization, roles and sales rules are unchanged.
By default Clerk connects directly using the configured publishable key; there
is no inferred host key or hosting toolbar. The existing proxy is optional:
configure it in Clerk, set `CLERK_PROXY_ENABLED=true`, and set
`VITE_CLERK_PROXY_URL=https://your-domain.example/api/__clerk` before building.
Do not assume users from a platform-owned Clerk tenant transfer automatically;
plan account ownership/export or re-invitation before changing live credentials.

## Email and stock

Email calls Resend directly with `RESEND_API_KEY` and a verified
`RESEND_FROM_EMAIL`. Attachments and idempotency keys are preserved. Missing keys,
timeouts and provider errors produce failed delivery status, never a false success.
No emails were sent during verification. Configure `DEALER_NOTIFICATION_EMAIL`
or the dealer contact settings. Resend domain verification is separate from hosting.

Grok continues posting JSON to the existing stock API with the dealership's
`STOCK_IMPORT_SECRET` and stock identifiers. API contracts have not changed.

## Remaining external services

Clerk and Resend are independent integrations, not hosting dependencies. Optional
Umami analytics is disabled until the owner configures it. Stripe is not yet
integrated: simulated reservation payment remains prohibited in production.
DNS, real account credentials, backups, database provisioning and a live sign-in /
email smoke test are deployment tasks, not completed by a passing local build.

## Removal audit

Removed Replit Vite plugins, connectors SDK, environment-domain fallback,
Chromium path assumption and artifact/deployment manifests. Legacy operational
notes are retained in `docs/legacy-replit-notes.md` for historical reference only.
Historical audit/migration documents and safety notes may still mention Replit;
these are not runtime dependencies. Platform-specific native-package exclusions
were removed so pnpm can install the binaries appropriate to the host OS/CPU.

## Verification — 24 September 2026

- Clean frozen-lockfile install passed, including pnpm 11 build-script permissions.
- Full workspace typechecking and all builds passed without Replit environment variables.
- 177 frontend unit/component tests passed.
- 80 backend tests passed, including 5 new portability checks and 8 reservation
  integration checks. Database suites used only the existing disposable loopback
  database `luxxy_test_milestone1` on port 55439. No migrations were run.
- The compiled production server served health, homepage, vehicle, portal and
  enquiry deep links and returned API 404s using a minimal synthetic environment.
  This verifies serving, not live Clerk sign-in or external email delivery.
- Full browser suite: 123 passed, 2 optional screenshot tests skipped, 3 failures.
  The failures were the 1024px saved-car fixture not appearing, a booking test
  expecting slots without selecting a car, and a mobile staff lead below its
  asserted first-screen position (757.5px versus a 700px limit). No UI changes
  were made to hide these failures. A serial rerun passed both saved-car widths;
  the booking expectation and mobile staff layout failures reproduced.
- Existing frontend large-chunk and tooltip sourcemap warnings remain.
- Live domain setup, independently owned Clerk/Resend accounts and live integration
  checks remain outstanding. No production service, database or migration was touched.

Provider setup references: [Clerk React](https://clerk.com/docs/react/getting-started/quickstart),
[optional Clerk proxy](https://clerk.com/docs/guides/dashboard/dns-domains/proxy-fapi),
[Resend email API](https://resend.com/docs/api-reference/emails/send-email).

## Email, payments and staff operations

Prepare migrations `0016_sale_workspace.sql` and `0017_staff_roles_settings_history.sql` for the target dealership database using the normal deployment migration procedure. They are not automatically applied or run by this work. The first authorised owner manages website settings, publication history, staff roles and private integrations.

Configure a persistent private directory for `INTEGRATIONS_PRIVATE_DIR` outside the frontend/static directory and set `INTEGRATIONS_ENCRYPTION_KEY` before using private settings in production. On Render, mount a persistent disk and point this directory at it. The same encryption key is required to restore an encrypted backup. The integration store supports a single API process; deploy each dealership independently.

Resend and Stripe start disabled. Owners use **Settings → Email templates** for all 16 email subjects/bodies and shared branding, and **Settings → API integrations** for provider credentials. Domain verification, live Stripe keys and the signed webhook must be configured before enabling delivery or payment. See [Email and reservation payments](integrations-email-payments.md) and [Dealer operations](dealer-operations.md) for setup, permissions, safe payment recovery and settings history.
