# Cars: recent viewing, customer interest and verified stock changes

Date: 24 October 2026. Branch: `codex/cars-interest-and-updates`.

## Result

- Staff Cars now has a compact Recently viewed strip. It remembers up to six successfully opened vehicles, with current accessible names/plates, and a Clear action. Storage contains IDs only in sessionStorage, separated by dealer and signed-in staff identity. Unavailable IDs never produce a card. Storage errors do not prevent using Cars. Customer browsing history stays separate.
- Each staff car row and detail header shows open enquiry and upcoming test-drive counts. Closed/merged enquiries and cancelled, past, completed or missed appointments do not inflate these counts. Counts describe enquiry records, not unique people or website views. The detail header also shows the next test drive in UK time.
- Staff see a compact summary of the car's latest completed import: effective advertised price before/after, photo counts and changed detail labels. Initial imports are not presented as updates. An unchanged subsequent import clears the earlier summary. Description/features are compared at the actual nested importer paths; raw values, contacts, URLs and import payloads are never projected into the summary.
- Customers see clearer verified Price reduced / Was / Save text in the existing stock and vehicle price areas. The vehicle page adds the UK date when the change was recorded. Evidence must still match the current price, be GBP and expire within the existing fourteen-day window (or sooner when the server specifies). Malformed, future, expired and superseded evidence stays hidden.
- The existing customer Recently viewed feature was checked on stock and vehicle pages at all three responsive sizes. It remains device-local with its existing thirty-day retention and Clear action.

No preparation UI was restored. No migration is required. No payments, agreed prices, invoices, customer-message delivery, stock import rules or live dealer schedules were changed. No deployment or push was performed.

## Verification

| Check | Result |
|---|---|
| Workspace typechecking | Passed |
| Production workspace build | Passed; existing source-map/chunk-size warnings remain |
| Backend inventory HTTP integration | Passed; real tenant-scoped queries, list/detail parity, lifecycle exclusions, effective price/currency/override guards, real nested description/features paths and private-data exclusion |
| Archive/history query regressions | 3 passed, including 30 current / 500 archived records and pagination |
| Local preview operations regression | Passed; counts derive from supplied enquiry records, not synthetic activity |
| Targeted frontend component/helper checks | New Cars, storage, public price, existing customer history and vehicle detail tests passed |
| Full frontend suite | 1,894 passed, 1 email-composer test failed in 184 files / 1,895 tests. The entire email-composer file then passed separately: 37/37. No email production/test code was changed to conceal the intermittent result. |
| Browser portal/Car/QR regressions | 7 passed at 390, 820/834 and 1440 px; includes six portal sections, recent-car reopening/clearing, customer interest, stock changes, focused detail sections and existing photo QR flow |
| Browser customer stock/recent history | 3 passed at 390, 834 and 1440 px; price evidence injected into local browser responses only; no saved stock mutation |
| Diff whitespace check | Passed |

The initial customer-storage helper run hit Node 25's experimental global localStorage collision. Tests were rerun with `NODE_OPTIONS=--no-experimental-webstorage`, allowing jsdom's browser storage to be used. This is a local test-runtime issue, not a production change.

An independent read-only review found the description/features importer-path mismatch; it was fixed and retested before completion. No other concrete correctness or tenant-isolation issue was identified.

## Evidence and limits

Logs: `/tmp/cars-updates-frontend-tests.log`, `/tmp/cars-updates-email-regression.log`, `/tmp/cars-updates-build.log`, `/tmp/cars-interest-backend.log`, `/tmp/cars-interest-history.log`, `/tmp/cars-interest-preview.log`.

Screenshots: `/tmp/luxxy-cars-updates-browser.png` (actual local preview); `/tmp/luxxy-cars-updates-390.png`, `/tmp/luxxy-cars-updates-820.png`, `/tmp/luxxy-cars-updates-1440.png` (fictional activity fixture); `/tmp/luxxy-public-stock-update-390-top.png` and matching 834/1440 px screenshots (fictional recorded-price evidence).

Responsive checks used desktop Chrome with phone/tablet viewport sizes. Actual iPhone Safari and iPad hardware were not tested. Live Render/database/import delivery and customer messaging were not exercised or changed. Public photo/detail update badges and customer-interest counts were deliberately not introduced without an existing verified public data contract.

The richer vehicle specifications from commit `3127638` are also still local and are included beneath this branch. They have not yet been released to Render.
