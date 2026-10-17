# Stock imports and compact dashboard summaries

The authenticated full-stock contract is unchanged. Grok still submits complete inventories, with the existing identity, validation, replay, timestamp ordering, quarantine, missing-advert and dealer-status safeguards. No heartbeat endpoint or worker schedule is introduced in this change.

## Meaningful changes versus source checks

The importer separates explicitly recognised collector metadata in `sourceExtras`: `lastCheckedAt`, `detailCheckedAt`, `detailFetchedAt`, `detailFreshness`, `detailSource`, `imagesLastCheckedAt` and `lastImageCheckedAt`. These values are stored under `vehicles.audit_metadata.sourceCheckMetadata`; the original complete request remains in the import run's raw snapshot.

Descriptions, features, source platform, plate provenance, nested history and unknown extras remain vehicle facts. They still trigger a real change. A timestamp-only check reports `updated: 0, unchanged: 24` for an otherwise identical 24-car inventory. Sightings and check metadata still refresh. Legacy raw vehicle rows do not require a migration or a wholesale rewrite: their facts are compared without technical check fields, and the public projection merges the latest check metadata back into `sourceExtras`.

The metadata update merges against the database row at write time, preserving a reservation owner or dealer audit information saved after the import's initial read. Raw snapshots remain complete unless an operator later enables the separate retention policy below.

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
| Quiet 24-car / 1,204-image import: SQL queries | 106 | 36 |
| Source-image read queries | 24 | 1 |
| Image rows written | 1,204 | 0 |
| Dashboard fixture: database-to-API transferred data | approximately 1.9 MB | approximately 4.3 KB |

The dashboard fixture has 30 sales with archived document data and 20 substantial raw snapshots. Counts and lists are compared against the original TypeScript calculation. Tests also cover duplicate replay, actual price/description/equipment/gallery changes, image reactivation, source-check metadata, dealer overrides, concurrent reservation-owner preservation, two missing confirmations, staff authorization and cross-dealer isolation.

These query/write/transfer measurements are reproducible local workloads, not promises about production latency or Grok's total runtime. The 24 per-vehicle sighting updates remain; the expensive repeated gallery writes and dashboard record transfers are removed.

## Platform import activity

Platform administrators can expand an import to inspect compact vehicle audit changes, applied old/new source prices, and adverts newly absent compared with the previous successful snapshot for the same dealer and marketplace. Source disappearance is not a sale. Existing missing visibility and dealer override safeguards remain unchanged. Price-review fields are flagged separately from applied source prices.

Summary cards include received/expected, added/changed/unchanged and cumulative missing counts, collection timestamp, errors and recorded backend processing duration (`updatedAt - receivedAt`). That duration is based on database run timestamps, excludes collection/network transfer and is not the end-to-end worker runtime. Replays have no separate import record. Vehicle details load on demand, are capped at 250 changed and 250 newly missing adverts, and never return full snapshots or image URLs. The detail endpoint uses the existing platform-host/admin guard and explicit dealer/run matching.

## Preparing for 100–200 dealers (17 October 2026)

This is preparation, not production capacity certification. There is no new paid service, marketplace collection, AI call or provider message in the capacity tests. Live stock schedules, delivery settings and credentials are unchanged.

### Import backpressure and public reads

`STOCK_IMPORT_CONCURRENCY` defaults to two uploads per API process (accepted range 1–4). Admission happens before JSON buffering. Extra imports receive HTTP 503, `status: busy`, error `import_capacity_busy`, `Retry-After: 15` and no-store. `runId` and `retailerId` are null in this early response because the body has not been read. The worker must wait and retry its original saved bytes/runId, with bounded backoff. Rejection is not a successful collection/import.

Body, authentication and routing failures release their slot. Once database processing starts, client disconnection does not release the slot until that operation actually ends. Counters include admitted requests that later fail; they are not successful-import counts. This gate is process-local and does not replace authentication, source pacing or abuse controls.

Public stock applies the existing visibility rules in SQL before loading galleries. One map groups each vehicle's images instead of rescanning every image for every car. The latest-import lookup returns just its source label and check time instead of transferring its whole raw inventory snapshot. Public response fields and dealer status/override rules are preserved.

### Background jobs and database

`TENANT_JOB_CONCURRENCY` defaults to two, capped at four. Reminder, push, Stripe expiry, retention and startup backfill sweeps share a FIFO limiter in one process. Each sweep has bounded lanes rather than one pending promise per dealership. Repeated ticks of the same named sweep join its active run. Failures are counted and reported after other dealers finish. Unconverted demos and suspended dealers are excluded. Each notification tick examines at most 50 oldest pending confirmations and 50 eligible confirmed reminders per dealer; remaining work waits for a later tick.

The shared database pool defaults to maximum 10 connections, 5-second acquisition timeout, 30-second idle timeout, 60-second server statement timeout and 60-second idle-transaction timeout. Optional overrides are in `.env.example`. Leave headroom for deployment overlap and admin tools; do not multiply per-process pools past the database's actual connection allowance. Idle-connection errors are handled without logging connection strings or terminating the process.

`GET /api/healthz` remains liveness. New `GET /api/readyz` probes only database connectivity, returns 200 ready or 503 not_ready, caches for five seconds, coalesces concurrent probes and has a two-second public deadline. It reveals no database internals. Render's configured health check remains healthz. Readiness is not an end-to-end stock/email test.

### Operator view and staff bookings

Platform administrators can use Overview → Platform operations to inspect database readiness/pool pressure, current import slots and deferred requests, bounded worker sweeps and live-dealer stock freshness. Collection time, rather than receipt time, drives the 13-hour warning / 14-hour overdue classification. Missing credentials, no first import and failed/held latest attempts remain visible. This is a manually refreshed snapshot, not an external alert delivery system; process counters reset on restart. Summary queries omit raw payloads, credential hashes and customer records. Latest-import indexes are included in migration 0040.

Staff appointment pickers use a staff-authenticated, tenant-scoped date diary rather than repeatedly downloading all customer correspondence. Adjacent local days cover overnight overlap and 71/73-hour DST windows. The response contains eight appointment fields, excluding contact details and timelines. Saves still recheck booking rules transactionally. Customer history/calendar records are not paginated by this change; only picker/exception checks use this smaller projection.

### Optional raw stock snapshot compaction — disabled

At 200 dealers, two roughly 650 KB snapshots daily would add about 260 MB/day of raw JSON before database compression. Migration 0040 only adds integrity fields/checks and indexes; it removes no data and does not backfill every existing payload during deployment.

Compaction requires an explicit `STOCK_RAW_RETENTION_DAYS` setting from 7 to 3650. Blank, zero or invalid configuration keeps it off. When enabled, the existing tenant retention sweep considers at most ten old successful payloads per dealer (helper maximum 25), skips a busy importer and always keeps the latest two successful snapshots per dealer/source. Recent, failed, quarantined and pending runs stay intact. This does not touch invoices, payments, vehicle audits or the run ledger.

Before removal, the helper calculates and verifies/backfills the existing canonical SHA-256 body identity atomically with setting the raw JSON null. Identical completed runs still replay, even after their freshness window; a reused runId with changed facts still conflicts. The original completion time is preserved. Hash mismatches are skipped for investigation. Counts and vehicle changes remain; a historical missing-advert comparison becomes explicitly unavailable if its source payload was compacted. Reported bytes are logical JSON removed, not measured physical database shrinkage. Review the policy before enabling it; failed payloads and audit ledgers still need a future long-term policy.

### Reproducible isolated checks

From `artifacts/api-server`:

```sh
pnpm run test:capacity:guards
pnpm run test:capacity
```

The first runs the fast safeguards, fixture integrations and local-adapter checks. The second also runs a serial 100/200-dealer workload against fresh embedded PostgreSQL, actual tenant resolution/import routes and loopback HTTP. It uses 30 fictional vehicles and 24 image URLs per vehicle, approximately 637 KB per request. No URL images are downloaded. Each size starts with empty stock, then receives identical replays and quiet new snapshots, followed by tenant-specific public reads. All 901 posts preserve counts, replay identity and tenant isolation.

Recorded workload on this development machine (two client lanes; embedded database shares the process):

| Fictional dealers | Initial imports, whole batch | Identical replays | Quiet refresh, whole batch |
| --- | ---: | ---: | ---: |
| 100 | 14.8 s | 1.1 s | 4.6 s |
| 200 | 40.6 s | 1.8 s | 9.3 s |

Measurements include per-request and queue-wait percentiles, CPU time, bytes and process memory in `output/capacity-2026-10-17/backend-capacity-results.json`. PGlite's embedded database/WASM memory is included in RSS; these figures cannot size the Render API's RAM. Its scheduling differs from network PostgreSQL and reached one active import at a time despite two client lanes. The separate burst test proves the two-permit gate with 200 simultaneous requests, including retryable refusal and disconnect handling. Neither test proves two real PostgreSQL imports' throughput or provider tolerance. Development-machine load can affect timings.

Before promising 100 or 200 live dealerships: complete Grok's scheduler/rate-limit/credential-isolation work, run an approved staging workload on network PostgreSQL with realistic public/portal traffic, measure database/CPU/memory/backlog/failure rates, and exercise restart and full-window outage recovery. Grow the controlled live pilot through 10, 25 and 50 dealers. Multiple API replicas additionally need cross-instance singleton leases/durable job coordination and pooled-connection sizing; the new process-local limits alone do not provide those.

## Growing sales, enquiry and stock history (17 October 2026)

The portal's enquiry and appointment lists now request `X-Enquiry-Timeline: omit`. They retain every matching enquiry, merge link, customer and appointment field, with `events: []`; unmodified API clients still receive the original full response. Summary and full query caches have separate keys under the existing invalidation prefix. This removes the repeated transfer of all conversation notes during polling without silently excluding customers or appointments.

Opening an enquiry loads `GET /api/staff/enquiries/:id/conversations`, with at most 25 conversation notes per page, an exact total and an opaque `nextCursor`. “Load older conversation notes” reaches the rest. Merged originals load their own history when expanded. Original messages and internal notes remain visible while a request is pending or fails; failed history requests have a retry action. The endpoint requires staff access and explicitly matches the dealer and enquiry. Its `(occurred_at, id)` cursor preserves PostgreSQL microseconds, including multiple notes created within one JavaScript millisecond. Existing enquiry-prefix invalidation refreshes an opened conversation after a write.

The sale workspace list removes archived document PDF data, private request replay maps and provider payment replay maps in PostgreSQL before transfer. Its public fields, payment records and document summaries are unchanged; the original documents remain available through their existing detail/download paths. Relationship reads similarly project public chat conversations/messages before transferring them, leaving private chat state behind.

`GET /api/staff/inventory` now defaults to current inventory. An explicit `scope=archived` returns 50 older cars per page, tenant totals, the exact matching count and `nextCursor`. The portal's Archived filter loads these pages on demand. Its `q` search runs in PostgreSQL before the page limit, so an older archived car remains findable without loading every prior page. Migration 0042 adds partial tenant/date/id indexes for current and archived inventory. No cars are archived or removed by this migration. The local preview mirrors the list/search contracts as a clearly labelled read-only adapter; connected-only photo, plate and preparation editing is not simulated.

Reproducible fictional PGlite fixtures (`pnpm run test:history` from `artifacts/api-server`):

| Workload and transfer boundary | Before | After |
| --- | ---: | ---: |
| 100 sales: database-to-API, including large archived PDFs/private replay maps | 2,588,671 bytes | 42,671 bytes |
| 100 chat records: database-to-API | 383,731 bytes | 19,871 bytes |
| Two merged enquiries / 1,000 notes: recurring list response | 1,868,768 bytes | 2,876 bytes |
| Selected enquiry conversation page | Full history above | At most 46,799 bytes in this fixture |
| 30 current / 500 archived vehicles: initial current response | All retained cars previously loaded | 9,604 bytes |
| Archived inventory page | All retained cars previously loaded | At most 17,360 bytes in this fixture |

The tests reach all 1,000 conversation notes exactly once over 40 pages and all 500 archived cars, including microsecond cursor boundaries; search finds the oldest archived match, foreign-dealer records remain inaccessible, and authentication/invalid cursors are checked. These are logical local transfer sizes, not Render RAM, production response times or limits on legitimate note content.

**Remaining scope:** enquiry/customer matching and calendars still receive the full set of enquiry summary records; the current inventory list, sales list and relationship graph are not fully paginated. Sale lists retain public document/payment history, and relationships still return full public messages when explicitly opened. These reads need further measurement as individual dealers accumulate years of records. Event data in legacy clients and mutation responses remains unchanged. The new pages do not impose a hidden maximum on retained history.

## Safe service restart

SIGTERM and SIGINT begin a drain before new request bodies are read. New work receives HTTP 503 and `Retry-After: 15`; stock imports retain their retryable busy response shape with null identity fields because the body has not been buffered. Worker intervals stop immediately. The retained HTTP server and tracked startup, worker, provider and import operations finish before `pool.end()` and a successful exit. A 25-second hard deadline exits with failure instead of closing the pool underneath unfinished work. Durable work remains eligible for its existing recovery path on restart.

`healthz` remains liveness (200) while `readyz` returns 503 during the drain. Start scripts use `exec` to pass termination to Node through the package-manager/shell chain. `pnpm run test:shutdown` covers nine checks, including a real child-process SIGTERM through that start-command chain. No Render configuration, schedule or secret is changed by this restart handling.
