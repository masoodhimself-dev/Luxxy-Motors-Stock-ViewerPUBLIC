# Separate Cazoo display test

This is a fixture-only customer showroom using the supplied 33-car snapshot from 8 October 2026. It is not a live dealer connection, importer, multi-tenant deployment or database test.

Build: `pnpm build:cazoo-demo`
Start: `pnpm start:cazoo-demo` (PORT defaults to 4180; Render sets PORT).

Only the separate `cazoo-demo.tsx` customer entry is bundled. There is no Clerk provider, local preview auth alias, staff portal, database connection, import credential, Resend integration or Stripe integration. All non-GET/HEAD API requests return HTTP 405 before reading their body. Unknown/private APIs return 404. Browsing, filtering, photos, saved cars and comparison operate on a fixed public snapshot. Factual descriptions use the same shared generator as the main implementation. Dealer branding is labelled Cazoo Demo; original dealership contact details, testimonials and service promises are not carried into the demo website.

Render free web service, Frankfurt, separate URL, branch `codex/cazoo-readonly-demo`, auto-deploy off. Build command: `corepack pnpm install --frozen-lockfile --prod=false && corepack pnpm build:cazoo-demo`. Start command: `corepack pnpm start:cazoo-demo`. No database, disk or secrets required. Free service idle wake-up delays may apply. This does not modify `luxxy-stock-staging`.

The banner and robots headers identify the test snapshot. Data is not refreshed and must not be represented as live current stock. Source photographs remain externally hosted and may change or become unavailable.

Verification: actual HTTP test validates 33-car schema, generated copy, separate settings, disabled reservations/private APIs and blocked writes. Browser QA checks desktop and 390px phone layouts and confirms no portal route. The main application's database import test remains a separate prerequisite for deploying its stock-platform changes.
