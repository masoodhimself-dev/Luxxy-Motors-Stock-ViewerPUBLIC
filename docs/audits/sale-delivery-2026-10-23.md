# Collection and delivery — 23 October 2026

Implemented on `codex/sale-delivery-handover` and deployed with user approval.

## Release verification

- Commit `a67be724d8f26ecccaafcf98e8397c9b89e03b7f`, pushed as a fast-forward to `codex/multi-tenant-foundation`.
- Render service `srv-db4jfhk9v7es73a4qhrg`; deploy `dep-dbdq6qbrjlhs7380uj00` reached `live` on 23 October 2026 at 18:14:55 UTC (19:14:55 UK).
- Luxxy and Shore Drive `/api/healthz` both returned `{"status":"ok"}`. No error-level runtime logs were returned for the release interval checked.
- Opened Shore Drive's existing saved sale in the live browser and verified the new collection/delivery panel, enabled manual email/WhatsApp buttons, and unchanged displayed paid/balance totals. This was read-only: no live handover, payment or message action was performed.
- Physical iPhone/iPad testing remains for the operator. No new migration, credentials, environment changes or automatic customer messaging were added.

## Behaviour

- Final invoice review offers collection or delivery, contact details, planned date/window, delivery address, driver and private staff notes. An unconfirmed date can remain blank.
- Saved sales show arrangements separately from payment totals. Staff can edit arrangements, mark a completed sale on the way, record an unsuccessful delivery, or use the existing handover confirmation to mark it delivered/collected.
- Home lists outstanding deliveries, including undated, overdue and unsuccessful deliveries. Completing handover or releasing the sale removes the task.
- Email opens the existing reviewed internal composer. WhatsApp uses the existing reviewed QR/handoff and sent-confirmation history flow, with the recipient number prefilled. Saving or changing status never sends automatically.
- Customer confirmations and the private purchase page reflect unsuccessful deliveries. Driver, internal notes and failure reasons are excluded from customer output.
- Payments, fees, balances and issued invoice snapshots retain their existing rules. A delivery fee must use the existing fees process before issuing an invoice. No database migration is required: arrangements use the existing fulfilment JSON.
- Handover is a staff confirmation using the existing permissions and outstanding-balance acknowledgement, not a new customer signature service.

## API and safety

- `GET /api/sale-workspace/delivery-tasks`: tenant-scoped, `sales.manage`, compact query capped at 100 records plus total count.
- `POST /api/sale-workspace/:id/fulfilment`: `sales.manage`, existing revision and request-id replay safeguards.
- Actual completion uses the existing `sales.handover` endpoint and permissions.
- Invalid dates/stages and premature dispatch are rejected. Completed handovers cannot be edited. Ambiguous saves require a reload; late responses cannot replace a different sale after navigation.

## Verification

- 38 sale reducer/store tests passed; 35 sharing/API integration tests passed, including permissions, tenant isolation, replay, conflicts and unchanged financial records.
- Six browser tests passed at 390, 834 and 1440 pixel widths: final-step selection, saved arrangements, manual email review, prefilled WhatsApp handoff, Home tasks, failed delivery and completed handover. Financial snapshots remained unchanged.
- Typechecking and production build passed.
- Responsive checks use browser emulation, not physical iPhone/iPad testing. No real customers were contacted, and no live financial or stock data was changed. Production load and large-history query performance were not benchmarked.
- All 1,877 frontend tests passed across 181 files in the final serial run. An earlier parallel run timed out in an existing email-summary test; that test also passed independently.
