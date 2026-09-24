# Luxxy Motors

Customer showroom and dealer portal, built with React/Vite, an Express API and PostgreSQL.

## Local design preview

From the repository root:

```sh
pnpm install
pnpm dev:preview
```

Open http://127.0.0.1:4175. The preview renders the actual customer and staff components with six vehicles and matching photographs from the repository’s archived stock snapshot. These are not current stock. Search, filters, galleries, vehicle details, saved cars and comparisons work locally. Staff records are synthetic. See [the redesign review](docs/ui-redesign.md) for routes and screenshots.

The preview has a separate Vite config and entry point. It requires no database or Clerk credentials, rejects normal production API writes (reservation/settings demonstrations use a local sandbox), and does not start the API server. The read-only staff preview uses a development-only identity shim. Real enquiries, bookings, staff sign-in and signing transactions need the full application. The normal production build continues to use `src/main.tsx` and the existing authentication.

The workspace enables native macOS dependencies as well as the original Linux dependencies. The original runtime is Node.js 24; this checkout was also verified with Node.js 25.5 and pnpm 11.19.

## Checks

```sh
pnpm typecheck:libs
pnpm --filter @workspace/luxxy-motors typecheck
pnpm --filter @workspace/luxxy-motors test
PORT=4175 BASE_PATH=/ pnpm --filter @workspace/luxxy-motors build
LUXXY_LOCAL_PREVIEW=1 pnpm --filter @workspace/luxxy-motors test:mobile-layout
```

On Node.js 25, run the unit tests with `NODE_OPTIONS=--no-experimental-webstorage` so jsdom supplies browser storage. Playwright needs its Chromium installation, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing browser executable (on this Mac: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).

Run `PORT=4175 BASE_PATH=/ pnpm build` for full workspace typechecking and builds. API integration suites delete data and must use an isolated local test database through `LUXXY_TEST_DATABASE_URL`; see [the milestone 1 notes](docs/milestone-1-verification.md).

## Full application

The original Replit database and credentials are not stored in GitHub. Full local operation needs a development PostgreSQL database (`DATABASE_URL`), Clerk development keys (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and frontend `VITE_CLERK_PUBLISHABLE_KEY`), and `SESSION_SECRET`. Configure staff access, stock-import credentials and notifications for the intended environment before using those services.

See [independent deployment](docs/deployment.md) and [.env.example](.env.example). `pnpm build` builds the workspace; `pnpm start` serves the website and API together. No database migration runs automatically.

## Project map

- `artifacts/luxxy-motors`: customer website, staff portal, frontend tests
- `artifacts/api-server`: API, stock ingestion, enquiries and sales
- `lib/db`: database schema and migrations
- `lib/api-spec`: API contract; `lib/api-client-react` and `lib/api-zod`: generated clients and schemas
- `artifacts/luxxy-motors/preview`: sample data used only by the local preview
