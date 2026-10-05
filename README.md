# Luxxy Motors

Customer showroom and dealer portal, built with React/Vite, an Express API and PostgreSQL.

See [the complete project guide](PROJECT_GUIDE.md) for customer features, staff workflows, sales and receipts, onboarding, stock imports, integrations, local-network use, deployment, testing and current limits. The guide was reviewed against the source on 5 October 2026.

## Local design preview

From the repository root:

```sh
pnpm install
pnpm dev:preview
```

Open http://127.0.0.1:4175. This development mode renders the actual customer and staff components using the repository's saved stock fixture and shared local records. It does not establish current live stock or production readiness. Search, galleries, saved cars, comparisons, enquiries, appointments, chat, sales and settings can be reviewed locally.

The development server has a separate Vite config and entry point. It requires no database or Clerk credentials and does not start the production API. Writable services persist in ignored `.local/` files, using a development-only staff identity adapter. They never send provider email or charge cards. Production uses `src/main.tsx`, Clerk staff identity, PostgreSQL and separately enabled integrations. Never deploy the development entry point.

For iPad/phone access, configure `LUXXY_PREVIEW_LAN_HOST` to the Mac's current private IP and bind Vite to `0.0.0.0`. Both are required. See [local-network instructions](PROJECT_GUIDE.md#21-local-development-and-ipadphone-access).

The supported Node engine is `>=24 <26`; the workspace uses pnpm 11.19.0 and supports appropriate native dependencies on macOS and Linux.

## Checks

```sh
pnpm typecheck:libs
pnpm --filter @workspace/luxxy-motors typecheck
pnpm --filter @workspace/luxxy-motors test
PORT=4175 BASE_PATH=/ pnpm --filter @workspace/luxxy-motors build
LUXXY_LOCAL_PREVIEW=1 pnpm --filter @workspace/luxxy-motors test:mobile-layout
```

On Node.js 25, run the unit tests with `NODE_OPTIONS=--no-experimental-webstorage` so jsdom supplies browser storage. Playwright needs its Chromium installation, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing browser executable (on this Mac: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).

Run `PORT=4175 BASE_PATH=/ pnpm build` for full workspace typechecking and builds. Database integration suites delete fixture data and must use an isolated local test database through `LUXXY_TEST_DATABASE_URL`; see [migration/test safety](lib/db/MIGRATIONS.md). Current migration-test assertions still need updating from the earlier 0016 snapshot to the current journal before full migration verification can be claimed.

## Full application

The application is independent of Replit. Full local operation needs an explicitly selected development PostgreSQL database (`DATABASE_URL`), matching Clerk development keys (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and frontend `VITE_CLERK_PUBLISHABLE_KEY`), and `SESSION_SECRET`. Configure intended staff access, stock credentials and integrations for that environment.

See [deployment in the project guide](PROJECT_GUIDE.md#23-deployment-and-copying-the-template) and [.env.example](.env.example). `pnpm build` builds the workspace; `pnpm start` serves the website and API together. No database migration runs automatically. Starting the production API does start workers and an enquiry-to-lead backfill, so it is not a read-only check against an existing database.

Resend and Stripe implementations exist, start disabled and require independent provider setup. The current sale workspace replaces the retired sales/signing/customer-intake process. Older dated documents and schema entries may describe superseded behavior; use the complete guide and current route modules alongside them.

## Project map

- `artifacts/luxxy-motors`: customer website, staff portal, frontend tests
- `artifacts/api-server`: API, stock ingestion, enquiries and sales
- `lib/db`: database schema and migrations
- `lib/api-spec`: API contract; `lib/api-client-react` and `lib/api-zod`: generated clients and schemas
- `artifacts/luxxy-motors/preview`: sample data used only by the local preview
