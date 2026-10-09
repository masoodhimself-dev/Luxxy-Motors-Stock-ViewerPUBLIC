# Stock platforms: Auto Trader and Cazoo

Each deployment has one active marketplace. This is a foundation for dealer templates, not multi-tenancy. Grok is the collector/transport; `vehicles.source` and successful import history store the marketplace (`autotrader` or `cazoo`). Existing Auto Trader records keep their source and IDs; no data migration is required for an existing deployment to continue using Auto Trader.

## Operator settings

Settings → API integrations → Stock connection. The real backend requires normal authenticated staff access with `integrations.manage`, plus the Clerk user ID explicitly listed in server `PLATFORM_ADMIN_USER_IDS`. A dealership owner role, portal machine token, email address or browser flag does not grant platform privileges. Leave this allowlist unset to disable the operator surface. Set your own verified Clerk user ID securely in server configuration to enable it.

Private settings contain platform, exact retailer reference, authorised HTTPS marketplace stock URL and enabled/paused flag. They use the existing encrypted private store and optimistic revision checks. They are excluded from public dealership settings and normal masked integration responses. The import secret remains in server `STOCK_IMPORT_SECRET`; the UI shows only whether one is configured. This does not create per-tenant credentials or a platform-wide admin dashboard.

When no saved connection exists, server `STOCK_PLATFORM` (default `autotrader`), `STOCK_RETAILER_ID` and optional `STOCK_SOURCE_URL` supply backward-compatible defaults. Invalid STOCK_PLATFORM configuration fails closed. A configured connection takes precedence. Changing platform/retailer when any vehicle records exist is blocked with HTTP 409: a reviewed migration is required to preserve linked sales, enquiries, reservations and stable vehicle IDs. Changing the source page or pausing the same connection is allowed. This task does not implement cross-marketplace vehicle matching or migration.

The development server retains its fixed existing stock fixture. The operator card is read-only on localhost and inaccessible from LAN clients. It neither receives live imports nor replaces stock when settings change. Tests use separate fictional records.

## Grok contract

Keep POST `/api/stock/imports/grok`, `x-stock-import-secret`, schemaVersion 1, `source: "grok"` and complete `cars` snapshots. No new field is required. `retailerId` must exactly equal the configured retailer reference (e.g. `cazoo-42656` for the supplied example). `sourceExtras.sourcePlatform` may declare `cazoo` or `autotrader`; when present it must agree with settings. Every supplied advert URL must be HTTPS on the configured marketplace. This restricts advert links, not image URLs. Images remain HTTPS URL references, with no OCR/registration invention. Cazoo's `cdn.images.autoexposure.co.uk` is also allowed by the PDF image fetcher; existing DNS/IP/redirect protections remain.

Do not change scheduled worker settings until the destination dealership connection has been approved. The attached Radlett Cars snapshot is an example only, not a request to replace existing stock. Its timestamp must not be rewritten merely to make an old collection pass freshness checks.

Paused imports return HTTP 409 `feed_paused`. Wrong marketplace returns HTTP 400 `platform_mismatch`. Existing authentication, retailer, schema, freshness, count, incomplete-snapshot, suspicious-price and missing-advert safeguards remain. Dealer statuses/overrides are preserved. Import and connection updates share a per-dealership transaction lock; the importer rechecks the connection before applying a new snapshot. Source switching is never inferred from a payload.

## Descriptions

The common stock projection automatically produces deterministic text when neither specifications.description nor sourceExtras.description/advertDescription supplies original text. It uses title/make/model, variant, year, numeric mileage, fuel, transmission and accepted public GBP price only. Missing facts are omitted. No condition, service history, owner, write-off, warranty or availability claims are generated. No AI credits or external calls are used.

Generated copy is in `sourceExtras.description`, with `descriptionOrigin: "generated-facts"` and template version 1. Staff vehicle information labels it. It is calculated on read from current effective facts, including accepted website price/title overrides, so later price changes do not leave stale generated text. Original feed descriptions always win; raw imported snapshots remain unchanged. The public vehicle page, portal stock information and printable sheet consume the same projected content. Empty feature/history sections remain omitted.

## Verification

Run `pnpm --filter @workspace/api-server test:stock-feed` and the existing stock, reservations and booking suites against a guarded disposable loopback PostgreSQL database. Run frontend tests and both application typechecks/builds. No live stock import, Render deployment, scheduler change or migration is performed by this implementation.

### Verification performed for this change

- Supplied Cazoo sample: all 33 vehicles pass the actual schema; 33 factual descriptions generated. No import submitted and no collection timestamp rewritten.
- 8 stock-feed tests, 18 reservation-policy tests, 9 integration-settings/provider tests and 17 frontend content/print/settings tests passed (52 total).
- API and frontend typechecks and production builds passed. Existing frontend chunk-size advisory remains.
- Actual customer pages exercised with browser-only Cazoo response fixtures on desktop and 390px phone; generated description is present, empty features are omitted, no page errors or horizontal overflow were observed.
- A Cazoo PostgreSQL HTTP import/retry/lifecycle integration case was added to the existing suite. It was not executed: no guarded disposable PostgreSQL test target is configured in this session. Run it before deploying. Existing local stock fixture and Render database were untouched.
- Render deployment and PLATFORM_ADMIN_USER_IDS configuration are pending. There is no live Cazoo connection.
