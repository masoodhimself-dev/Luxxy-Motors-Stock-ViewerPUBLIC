# Cars updates: verified Render release

Released 24 October 2026 at 08:17:56 UK time (07:17:56 UTC).

- Workspace: My Workspace (`tea-db1svi4s728c73e0k6k0`), previously confirmed by Masood.
- Existing service: luxxy-shared-staging (`srv-db4jfhk9v7es73a4qhrg`).
- Release branch: `codex/multi-tenant-foundation`, fast-forwarded without force from `0de3b98` to `386ca36ecc23b778c4671d7583b035659e059318`.
- Deploy: `dep-dbe5llss728c7398dtn0`, verified `live` at the expected commit.
- Automatic deployment remains off; a single explicit deployment was triggered.
- Previous live deploy: `dep-dbe11vbrjlhs738m2q30` at `0de3b98841a98776139105a57b6761cfe7c118d3`.

## Included

The richer recorded Cars specifications from `3127638`, staff recently viewed shortcuts, open enquiry/upcoming test-drive counts and latest completed stock-import summaries, plus clearer verified public price reductions. Independent read-only release review found no blocker. No new migrations, financial rules, stock import/delivery schedules or message-sending behavior were introduced. Customer email and WhatsApp sending remain manual; no customer message was sent during release verification.

## Live checks

| Check | Luxxy | Shore Drive |
|---|---|---|
| `/api/healthz` | HTTP 200, ok | HTTP 200, ok |
| `/api/readyz` | HTTP 200, ready | HTTP 200, ready |
| `/api/stock` | HTTP 200, 24 public cars | HTTP 200, 22 public cars |

Authenticated Shore Drive browser checks verified:

- Current Cars list loads 23 staff records, including the sold record intentionally absent from public stock.
- Rich vehicle specifications, availability, prices and actual enquiry counts render.
- Hyundai ix35 list/detail agree on two open enquiries and no upcoming visits.
- Car details show the latest completed import date and honestly report no recorded price/photo/detail change for that import.
- Returning to Cars reveals the recent shortcut; reopening it returns to the correct Hyundai record.
- No preparation UI was restored. No sales, appointments, stock records or settings were changed.
- Recent runtime error/fatal log checks returned no entries after the release.

The first HTTP verification attempt using Python's default user-agent was rejected with 403. Retrying normal browser-style requests returned all six expected HTTP 200 responses above; the authenticated browser also loaded the live interface successfully.

Screenshot: `/tmp/luxxy-cars-render-release-2026-10-24.png`.

Pre-release verification remains recorded in `cars-interest-and-updates-2026-10-24.md`: typecheck/build and backend checks passed; ten responsive browser checks passed; full frontend run 1,894 passed/one intermittent email-composer failure, with that full file subsequently passing 37/37 separately.

Physical iPhone/iPad testing is left to Masood. No real-camera, email-delivery or WhatsApp-send test was attempted in this release.
