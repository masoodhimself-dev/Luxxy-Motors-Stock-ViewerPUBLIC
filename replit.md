# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

- **Link previews for shared vehicles.** The showroom is a client-rendered Vite
  SPA served as static files in production, so nothing can inject per-vehicle
  tags into `/vehicle/:id` before JavaScript runs. Two paths cover the two kinds
  of visitor:
  - **In the browser** (and for crawlers that render JS, e.g. Googlebot), each
    page writes its own title, description, canonical, Open Graph and Twitter
    tags via `usePageMeta` / `src/lib/page-meta.ts`, restoring the shell
    defaults in `index.html` on unmount.
  - **For crawlers that do not run JS** (WhatsApp, Facebook, Slack, iMessage,
    Twitter), the API server serves `/share/vehicle/:id` — a server-rendered
    page carrying the vehicle's tags, `rel=canonical` to `/vehicle/:id`,
    `noindex, follow`, and a meta-refresh plus `location.replace` so people who
    tap the link land on the real page. `getVehicleShareUrl()` builds the links
    the WhatsApp CTAs hand out; `/vehicle/:id` stays the canonical, shareable
    address everywhere else. `/share` is registered as a path on the API service
    in its `artifact.toml`.
  - Title and description copy lives once in `@workspace/vehicle-meta` so the
    preview card and the page it opens never drift apart.

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
