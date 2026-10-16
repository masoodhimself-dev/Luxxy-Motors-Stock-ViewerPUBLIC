# Stock imports and compact dashboard summaries

The authenticated full-stock contract is unchanged. Grok still submits complete inventories, with the existing identity, validation, replay, timestamp ordering, quarantine, missing-advert and dealer-status safeguards. No heartbeat endpoint or worker schedule is introduced in this change.

## Meaningful changes versus source checks

The importer separates explicitly recognised collector metadata in `sourceExtras`: `lastCheckedAt`, `detailCheckedAt`, `detailFetchedAt`, `detailFreshness`, `detailSource`, `imagesLastCheckedAt` and `lastImageCheckedAt`. These values are stored under `vehicles.audit_metadata.sourceCheckMetadata`; the original complete request remains in the import run's raw snapshot.

Descriptions, features, source platform, plate provenance, nested history and unknown extras remain vehicle facts. They still trigger a real change. A timestamp-only check reports `updated: 0, unchanged: 24` for an otherwise identical 24-car inventory. Sightings and check metadata still refresh. Legacy raw vehicle rows do not require a migration or a wholesale rewrite: their facts are compared without technical check fields, and the public projection merges the latest check metadata back into `sourceExtras`.

The metadata update merges against the database row at write time, preserving a reservation owner or dealer audit information saved after the import's initial read.

## Galleries

The importer reads active source images and dealer-owned URL claims for current incoming vehicles in one query. It upserts only new, reactivated or changed source URLs/captions/order/hero selection. Unchanged image rows remain untouched; vehicle sightings establish that the advert was checked. An image's `lastSeenAt` is now its last insertion or changed-gallery observation, not an independent verification that the URL loaded.

Absent source photos are deactivated; dealer photos are untouched. Reappearing URLs retain their original IDs and `firstSeenAt`. Missing adverts still receive one confirmation per accepted new snapshot, in bounded batches of 500 rows; replay never adds a confirmation or marks a car sold.

## Dashboard

`GET /api/dealer-operations` keeps its response shape and staff/dealer access checks. PostgreSQL calculates counts, conversions and balances and returns at most ten appointments, balances and deliveries. Confirmed signed payments include refunds/corrections; pending money is excluded. Released sales, customer credits, legacy PX, delivery after sale completion and penny amounts retain the existing calculation rules.

The summary never transfers sale archive PDFs or customer messages to the API process. Stock-health reads explicitly select operational columns, excluding raw inventory snapshots. The full sale/payment export remains available on demand. Existing dashboard polling remains unchanged.

## Isolated verification and measurements

Tests run against in-memory PostgreSQL (PGlite), fake Clerk identities and loopback HTTP with fictional dealerships. They do not load application secrets or write production data.

From `artifacts/api-server`:

```sh
node test-stock-performance-build.mjs
node --test dist-test/stock-performance.test.mjs
node test-tenancy-build.mjs
node --test dist-test/multitenancy.test.mjs
```

Optional measured baseline uses the original importer from commit `7c75b994b6bb62bd2ee8f08901de139bc33f7f11` (that commit must exist locally):

```sh
node test-stock-performance-build.mjs --baseline
node --test dist-test/stock-performance-baseline.test.mjs
```

| Isolated workload | Before | After |
| --- | ---: | ---: |
| Quiet 24-car / 1,204-image import: SQL queries | 106 | 35 |
| Source-image read queries | 24 | 1 |
| Image rows written | 1,204 | 0 |
| Dashboard fixture: database-to-API transferred data | approximately 1.9 MB | approximately 4.3 KB |

The dashboard fixture has 30 sales with archived document data and 20 substantial raw snapshots. Counts and lists are compared against the original TypeScript calculation. Tests also cover duplicate replay, actual price/description/equipment/gallery changes, image reactivation, source-check metadata, dealer overrides, concurrent reservation-owner preservation, two missing confirmations, staff authorization and cross-dealer isolation.

These query/write/transfer measurements are reproducible local workloads, not promises about production latency or Grok's total runtime. The 24 per-vehicle sighting updates remain; the expensive repeated gallery writes and dashboard record transfers are removed.

## Platform import activity

Platform administrators can expand an import to inspect compact vehicle audit changes, applied old/new source prices, and adverts newly absent compared with the previous successful snapshot for the same dealer and marketplace. Source disappearance is not a sale. Existing missing visibility and dealer override safeguards remain unchanged. Price-review fields are flagged separately from applied source prices.

Summary cards include received/expected, added/changed/unchanged and cumulative missing counts, collection timestamp, errors and recorded backend processing duration (`updatedAt - receivedAt`). That duration is based on database run timestamps, excludes collection/network transfer and is not the end-to-end worker runtime. Replays have no separate import record. Vehicle details load on demand, are capped at 250 changed and 250 newly missing adverts, and never return full snapshots or image URLs. The detail endpoint uses the existing platform-host/admin guard and explicit dealer/run matching.
