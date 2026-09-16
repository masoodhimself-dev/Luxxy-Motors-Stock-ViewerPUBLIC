# Luxxy Motors

Customer showroom and dealer portal, built with React/Vite, an Express API and PostgreSQL.

## Local design preview

From the repository root:

```sh
pnpm install
pnpm dev:preview
```

Open http://127.0.0.1:4175. The preview renders the actual customer-facing components with four clearly labelled sample vehicles. Photos are intentionally absent because the repository does not contain the live inventory. Search, filters, vehicle details, saved cars and comparisons work locally.

The preview has a separate Vite config and entry point. It requires no database or Clerk credentials, rejects all API writes, and does not start the API server. Enquiries, bookings, staff sign-in and signing transactions need the full application. The normal production build continues to use `src/main.tsx` and the existing authentication.

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

The whole-workspace `pnpm typecheck` currently reports existing errors in the API sales/enquiry routes and lead integration tests. Customer frontend checks can run independently. API integration suites delete data and must use an isolated test database; see `.agents/memory/stock-integration-test-isolation.md`.

## Full application

The original Replit database and credentials are not stored in GitHub. Full local operation needs a development PostgreSQL database (`DATABASE_URL`), Clerk development keys (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and frontend `VITE_CLERK_PUBLISHABLE_KEY`), and `SESSION_SECRET`. Configure staff access, stock-import credentials and notifications for the intended environment before using those services.

See `replit.md` for API commands and `.replit` for the original runtime configuration. The normal frontend expects `PORT` and `BASE_PATH` in its process environment and `/api` and `/share` to route to the API server.

## Project map

- `artifacts/luxxy-motors`: customer website, staff portal, frontend tests
- `artifacts/api-server`: API, stock ingestion, enquiries and sales
- `lib/db`: database schema and migrations
- `lib/api-spec`: API contract; `lib/api-client-react` and `lib/api-zod`: generated clients and schemas
- `artifacts/luxxy-motors/preview`: sample data used only by the local preview
