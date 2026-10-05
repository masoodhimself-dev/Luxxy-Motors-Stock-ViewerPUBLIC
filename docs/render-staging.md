# Render staging deployment

Prepared 5 October 2026. **Not deployed.** The current local website remains unchanged.

The user has chosen to test on Render first. This is a new staging deployment of
the real application, not the fixture-only Vite preview and not an existing live
dealership database. It serves the React website, Express API and vehicle share
pages on one HTTPS origin. Grok delivery stays disabled until the importer passes
authenticated tests.

## Concrete resource proposal

[render.staging.yaml](../render.staging.yaml) proposes:

- One Node 24 web service, `luxxy-stock-staging`, `0.5c-512mb` (Starter), Frankfurt region.
- One separate Render PostgreSQL 16 database, `luxxy-stock-staging-db`,
  `0.1c-256mb` (Basic 256 MB), 1 GB database storage, same region,
  database `luxxy_stock_staging_db`.
- One 1 GB persistent private disk mounted at `/var/data`, with encrypted
  integration settings in `/var/data/dealer-integrations`.
- A single service instance and manual deployments (`autoDeployTrigger: off`).
- Retailer `10045264`, internal dealership scope `paramount-staging`.
- Render-generated import/session/encryption secrets; email and reservation
  payment delivery disabled initially. No source/customer data is seeded.

These are **billable proposed plans**, not created resources or a price quote.
Confirm current workspace billing, resource prices, region and budget in Render
before creating/syncing. Persistent disks require a paid service and preserve only
files below their mount path. The current integration store supports a single API
process; do not enable horizontal scaling with this file-backed store.

At the published rates checked on 5 October 2026, proposed service compute is
$7/month, database compute $6/month, 1 GB database storage $0.30/month and the
1 GB private disk $0.25/month: approximately **$13.55/month**, excluding any
workspace plan, usage, taxes or currency conversion. Confirm actual checkout
prices before provisioning. Legacy plan names remain accepted; this file uses the
current compute plan IDs.

## Confirmed account/setup status

The user connected Render and approved paid staging in **My Workspace**
(`tea-db1svi4s728c73e0k6k0`). The initial billing error has cleared. The isolated
database `dpg-db1t3pcs728c73e11mng-a` is available, with database name
`luxxy_stock_staging_db` and user `luxxy_stock_staging_db_user`. Reuse this resource;
do not create another database or change its immutable name/user.

Clerk CLI 3.4.0 is authenticated and linked to application
`app_3KHcwNbnu7UACpExcwRiNFJffzo`, development instance
`ins_3KHcwOQ6M5wN1Q0bqOYESpYe9xZ`. Keys were written by Clerk into the ignored
local environment file without displaying them. `clerk doctor` confirms the
application and development keys. Root framework detection failed; frontend
detection succeeds but proposes a duplicate provider, so scaffolding was declined
and the existing React/Express integration retained. The frontend accepts the
CLI's public-key variable as well as the existing Vite-prefixed variable; the
secret key is never exposed. Production Clerk instance is not configured.

Render web service, secure provider-key injection, staff allowlist, staging
migrations/imports and end-to-end authentication verification remain pending.

### Clerk staging application setup

1. Sign in or create the account that will own this dealership's identity service
   at [Clerk Dashboard](https://dashboard.clerk.com/). Use the operator's account;
   never use the local preview's fake identity.
2. Create an application for the dealership's staging environment. Configure the
   chosen staff sign-in methods and retain the development/test instance for this
   isolated staging setup.
3. In that application's API Keys view, enter its publishable key in both Render
   `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY`, and its secret key in
   Render `CLERK_SECRET_KEY`, using the secure environment editor.
4. Set `PORTAL_STAFF_EMAILS` to the intended authorised operator/staff accounts;
   configure the application's allowed origins/redirects for the actual allocated
   Render hostname. Sign-in alone is not proof of staff permissions.
5. Rebuild after setting/changing the frontend publishable key. Test sign-in,
   unauthorised portal access rejection and the intended owner's permissions.
   Use a separately configured production Clerk instance before customer go-live.

The service's actual hostname is allocated by Render and is not invented here.
The start command supplies Render's `RENDER_EXTERNAL_URL` as `PUBLIC_SITE_URL`
unless an explicit public origin is configured. It retains the application's
normal HTTPS-origin validation. A later custom domain needs an explicit
`PUBLIC_SITE_URL` and matching Clerk configuration; DNS is outside initial staging.

## Prerequisites and publication

1. Connect the intended Render workspace and confirm resource costs. No raw keys
   or database URLs should be pasted into chat.
2. Publish the reviewed **current source**, including untracked implementation
   files and migration journal/snapshots, to an approved Git branch accessible to
   Render. The existing remote is
   `https://github.com/masoodhimself-dev/Luxxy-Motors-Stock-ViewerPUBLIC.git`.
   Current local changes are not automatically in that remote. Deploying its
   current old commit would omit recent features. Do not blindly commit local
   runtime/customer files, screenshots, output folders, `.env` or `.private`.
3. Review whether this public repository is appropriate for the deployment source;
   keep secrets and private records out regardless of repository visibility.
4. Use an independently owned Clerk **test/staging** application with matching
   `CLERK_PUBLISHABLE_KEY` and `VITE_CLERK_PUBLISHABLE_KEY`, its secret key, and the
   authorised staff email allowlist in `PORTAL_STAFF_EMAILS`. Enter them through
   Render's environment settings, not source files. A fake development identity
   must not be exposed. The frontend key is embedded during build.
5. Confirm the new database's identity and empty status before applying migrations.
   Do not point this deployment at an existing live database.

## Build, database setup and start

Repository root is the Render service root. The Blueprint path is explicitly
`render.staging.yaml`. Do not configure port 4175, `dev:preview`, or a Vite preview
server as the deployed application.

Build command:

```sh
corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm build
```

This installs build-time dependencies using the repository's pinned pnpm version.
Root typechecking and all production builds passed locally on 5 October 2026;
Render/Linux installation and the deployed build still need verification.

Start command:

```sh
PUBLIC_SITE_URL="${PUBLIC_SITE_URL:-$RENDER_EXTERNAL_URL}" corepack pnpm start
```

The root start script serves `artifacts/luxxy-motors/dist/public` and the real API.
It uses Render's provided `PORT`; the application listens on all interfaces.

There is deliberately **no automatic migration/seed hook** in the Blueprint.
Before using stock or the portal, apply the committed migrations to the explicitly
verified **new staging database**, using the controlled Render service environment
and the repository's existing migration command:

```sh
# DATABASE WRITE: only after verifying the isolated staging target.
corepack pnpm --filter @workspace/db run migrate
```

This reads the service's secure `DATABASE_URL`; do not put credentials in the
command. Follow [the migration notes](../lib/db/MIGRATIONS.md), include the complete
reviewed migration history through `0020_enquiry_merges`, and do not use schema
push/reset to make an error disappear. For any migration failure, stop and inspect
the new target; do not retry against a different database. Shell availability and
the controlled migration execution method must be verified after connecting the
Render workspace. A service may initially start with missing-table worker errors
until schema setup is complete: `/api/healthz` alone is not database readiness.

Startup launches reminder/payment workers and enquiry lead backfill. On this empty
isolated database no existing customers are involved. Leave external provider
credentials absent and delivery disabled while testing. Do not transfer local
preview enquiries, chat transcripts, sales or reservations into this staging DB.
Dealer branding/settings need deliberate onboarding; an empty database does not
automatically reproduce local file-backed preview settings.

## Deployed verification

- [ ] Confirm deployed revision matches the reviewed source and complete builds.
- [ ] Verify HTTPS `/`, `/stock`, vehicle routes, `/portal` and refresh/deep links.
- [ ] Verify schema/migration history and real database-backed stock requests;
  basic `/api/healthz` liveness is insufficient.
- [ ] Verify real Clerk sign-in, configured staff identity and portal permissions.
- [ ] Verify private settings survive a restart/redeploy, remain encrypted and
  cannot be fetched from the public static directory. Preserve encryption/session
  secrets for that staging environment.
- [ ] Run the [Grok isolated import checklist](integrations/GROK_BOT_PROMPT.md):
  full import, same-run replay, wrong secret/retailer, incomplete collection,
  price/drop/missing rules and dealer-state/override preservation.
- [ ] Record actual API acknowledgements and inspect stock/import audit state.
  Tests are staging writes, not dry runs. Synthetic examples must use a fresh run
  ID, actual test timestamp and the staging retailer configuration.
- [ ] Run a fresh authorised Paramount collection only after synthetic tests pass;
  do not rejuvenate the cached seed's timestamp or replay an old outbox blindly.
- [ ] Confirm Grok's secure secret injection, TLS verification/redirect refusal and
  operator notification delivery before authorising its first staging POST.

## Values to return to Grok after verification

Only after Render allocates the actual URL and tests pass:

```text
GROK_BACKEND_BASE_URL=<actual allocated HTTPS origin, no /api>
GROK_APPROVED_BACKEND_HOST=<actual hostname only>
GROK_APPROVED_BACKEND_PORT=443
GROK_EXPECTED_RETAILER_ID=10045264
Internal backend STOCK_DEALER_ID=paramount-staging
Secure secret reference=<approved runtime secret-store reference>
POST /api/stock/imports/grok
Header: x-stock-import-secret
```

Securely provision the matching `STOCK_IMPORT_SECRET` into Grok's secret store as
`GROK_STOCK_IMPORT_SECRET`. Do not return the actual secret in chat or logs.
Description/features use `sourceExtras.description` / `sourceExtras.features`.
Clearly readable OCR plates may be supplied with OCR provenance and
`vrmVerified: false`; uncertain values remain null.

Mark status separately: deployment prepared; Render resources created; migrations
applied; website/authentication verified; first isolated import verified; Grok
recurring execution verified. None is implied by another. Initial setup does not
enable email, payments or customer-facing production operation.

## Provider references

- [Render Blueprint specification](https://render.com/docs/blueprint-spec)
- [Render Node version selection](https://render.com/docs/node-version)
- [Render-provided environment variables](https://render.com/docs/environment-variables)
- [Persistent disks and single-instance restrictions](https://render.com/docs/disks)
- [Current Render pricing](https://render.com/pricing)
