# Refresh bandwidth improvements — 25 October 2026

## Scope

Reduce unnecessary repeat transfers. Stock photographs continue to load from their supplied external hosts. Downloads, media delivery, invoices, sales, booking rules, import schedules and customer message sending are unchanged. No migration or deployment is part of this change.

## Changes

- The public stock API supplies a SHA-256 validator for its complete canonical public JSON, scoped to the dealership and stock source. A matching `If-None-Match` returns HTTP 304 with no catalogue body. Price, availability, descriptions, equipment, image URLs, removal and returned check-time changes produce a new validator and fresh data.
- StockProvider keeps its last validated response and validator only in its own memory. It explicitly validates that copy even on demo sites, whose `no-store` policy remains intact. It does not persist a stock snapshot in browser storage or introduce a shared dealer cache. A provider without data recovers once from an unexpected 304. Failed or malformed refreshes do not overwrite its validated copy.
- Stock checks run every **five minutes**, reduced from once a minute at the user's request. Hidden/offline pages pause stock polling and revalidate stale data when they return. Existing query invalidation after stock-changing actions remains supported. Normalising unchanged data no longer recreates every car object.
- Feature availability checks stay fresh for one minute, preventing extra requests as additional consumers mount. Error handling still disables features on failed checks; server-side permission and availability checks are unchanged.
- Customer chat configuration avoids overlapping requests and pauses hidden/offline. Staff chat, unread indicators and presence explicitly honour visibility and connection state. Active-chat polling intervals remain unchanged.
- Local reservation-aware preview stock uses the same validator scheme, including local price and reservation overrides.

## Validation

- Frontend complete suite: **203 files / 2,201 tests passed** using bundled Node 24. Includes the customer-page preview renderer, stock, chat, booking and sales UI tests.
- Focused stock loader/provider and refresh policy/feature tests: **15 passed**, included above. Cover unchanged responses, price/availability changes, independent providers, cache loss, malformed/error responses, cancellation, hidden/offline pauses and resuming.
- After changing the stock interval to five minutes, **12 focused stock/refresh tests and frontend typechecking passed**. The tests explicitly confirm no automatic request after one minute, a check after five minutes, and no polling during ten minutes hidden or offline. Idle visible pages may show an older price/status for up to five minutes; booking, reservation and sale writes still validate current server data.
- API conditional-stock tests: **2 passed**. Exercise a real ephemeral HTTP server, dealer/source isolation, changed public fields, 304 responses and demo privacy headers.
- Frontend and API typechecking passed. Production frontend build passed (existing large-chunk advisory remains).
- Actual running local preview `/api/stock`: initial HTTP 200 body **142,962 bytes**, then HTTP 304 body **0 bytes** using its validator. These are uncompressed body bytes, excluding HTTP headers, not Render usage measurements.
- Browser inspected the local Settings page, stock list and Ford vehicle detail; data continued to display correctly.

## Limits

- This avoids transferring unchanged catalogue JSON; the server still reads/projects stock to validate the current representation. It does not claim reduced database work.
- Active open chat still refreshes its full conversation at the existing interval. This change avoids unnecessary hidden/offline traffic rather than introducing a new chat transport.
- No live bandwidth/billing measurements, production deployment or physical-device testing were performed.
- Host Node 25 has an existing jsdom localStorage setup incompatibility; validation used the available Node 24 runtime.

Branch: `codex/efficient-refresh-2026-10-25`.
