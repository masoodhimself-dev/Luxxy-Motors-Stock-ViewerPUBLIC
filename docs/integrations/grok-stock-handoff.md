# Grok Bot → dealership website integration

This handoff describes the existing implementation, not a proposed API. Send it with `grok-stock-example.json` and the canonical OpenAPI source at `lib/api-spec/openapi.yaml`. No live import has been performed as part of preparing this document.

## Message for Grok Bot

You supply the stock feed. The website backend validates and stores it, applies visibility/price safeguards and serves saved stock to customers. You do not communicate with the coding assistant at runtime. Do not access customer, reservation, authentication, settings or sales routes for stock synchronisation.

For each separate dealership deployment we will provide an HTTPS base URL, a retailer ID and an import secret via a secure channel. Never embed the secret in JSON, browser code, URLs or logs.

### Routes

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/stock/imports/grok` | Send a complete stock snapshot; header `x-stock-import-secret` required |
| GET | `/api/stock` | Read the currently public stock and website-generated vehicle IDs |
| GET | `/api/vehicles/{id}` | Read one public vehicle using its website ID, not its source advertId |
| GET | `/api/healthz` | Basic service liveness only; not a database/import readiness check |

Use `Content-Type: application/json`. The backend body limit is 25 MB. Send image URLs, not base64 images. There is also a legacy `/api/stock/imports/autotrader` adapter; use the Grok route only. Internally both adapters share the existing stock namespace, so do not alternate sources as if they were separate inventories.

### Payload rules

Use schemaVersion 1 and source `grok`. See the accompanying complete example and OpenAPI `StockImportEnvelope` / `ImportedVehicle` definitions. Replace its timestamp, retailer, run ID, example car and image URLs before any test.

- Every snapshot represents ALL currently listed vehicles for this retailer, not a delta or page of results. A partial successful scrape must never claim completeness.
- `count` and `expectedAdvertCount` must both equal `cars.length`; accepted runs require `complete: true`, `failedAdvertIds: []` and `errors: []`.
- `scrapedAt` is an ISO timestamp for the actual collection time. The default freshness window is 24 hours; more than five minutes in the future is rejected.
- Each vehicle needs a stable, unique `advertId`. Preserve it between runs. Do not send the website's `id` or inventoryStatus in the import.
- All vehicle keys in the example are required; unknown nullable facts use null, images use an array. Do not invent mileage, registration, ownership, condition or insurance history.
- Use full cash prices in GBP (e.g. 14995), not pence, currency strings or monthly finance. Current storage truncates fractional pounds; agree any need for pence before integrating.
- Images have `{ "url": "https://…", "caption": null }` or a truthful caption. Both image and hero URLs must use HTTPS. Keep URLs stable and accessible; list the preferred first image first.
- Use `specifications` and `sourceExtras` for agreed additional source data, not arbitrary new top-level keys. Website display of additional facts requires agreed mappings.
- This version accepts writeOffCategory S, N or null. If another known category occurs, stop and request a schema/mapping change rather than representing it as unknown or omitting the disclosure.

### Delivery and acknowledgements

Send one run at a time, oldest first. Start with a proposed 30-minute cadence, subject to source permissions and dealer needs. The website does not schedule Grok or call a Grok polling URL.

Create a new runId per new snapshot. After a timeout or transient 5xx, retry the identical payload with the same runId using bounded exponential backoff. Do not regenerate the timestamp on a retry. Changed/corrected content needs a new runId. Avoid overlapping or out-of-order jobs: there is no strict per-retailer timestamp-order rejection within the freshness window.

| HTTP | Meaning / action |
| --- | --- |
| 201 | Imported; record runId and received/created/updated/unchanged counts |
| 200 | Identical completed run replayed safely |
| 400 | Invalid fields/retailer/data; fix before sending a new run |
| 401 | Import secret missing/incorrect; stop and check configuration |
| 409 | runId conflict; do not retry changed content under that ID |
| 422 | Quarantined; investigate completeness, errors, age or stock-count drop; do not circumvent by repeatedly sending smaller snapshots |
| 413 | Body too large; reduce metadata/image URL volume or agree a server limit change; do not split into partial stock snapshots |
| 500 | Inspect error code: configuration_error needs setup correction; transient failures can use bounded retries |

A success response includes schemaVersion, status (imported/replayed), runId, source, retailerId, received, created, updated, deleted, unchanged and errors. Errors include code/message/path/advertId. There is no separate authenticated import-history/status endpoint or webhook back to Grok at present. Public stock is not a complete import audit, since hidden/quarantined prices and dealer-controlled status affect visibility.

### Existing safeguards

Defaults (deployment configurable): more than a 30% stock-count drop quarantines a snapshot; prices below £500 or changes over 50% are flagged for review; missing vehicles are hidden after two accepted missing snapshots. Vehicles are not hard-deleted (`deleted` is zero). Imports preserve dealer-controlled reserved/sold/archived status and local overrides. Never send an empty snapshot merely because collection failed.

### Deployment configuration / first test

Operator sets `STOCK_IMPORT_SECRET`, `STOCK_RETAILER_ID` and `STOCK_DEALER_ID` separately for each deployment. The base URL must reach the actual backend. `127.0.0.1:4175` and local `preview-*` cars are a development preview, not a public integration destination. There is no dry-run import flag: an accepted POST changes the target stock database. First use an isolated staging database, test a complete snapshot, repeat it unchanged to confirm replay, then verify the public GET routes. Production imports require an explicitly agreed destination and go-live.

Please reply with your proposed JSON sample, source of truth, update schedule, image-host behaviour and whether you can preserve stable advert IDs. We can validate your sample against this schema before any real import.
