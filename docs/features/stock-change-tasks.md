# Stock changes in Home

Staff see a compact Stock changes worklist in Home. Open tasks with upcoming visits or paid commitments appear first. Each task links to Cars, affected customer enquiries and, where applicable, vehicle history for bookings and payments.

## Detection and persistence

- A price task requires a genuine decrease in the effective published GBP price. A website override takes precedence over the source price. Initial imports, unchanged prices and suspicious prices held for review do not create a reduction.
- Published price history supplies the existing public “Price reduced” label for 14 days. Imported reduction claims are discarded. Currency changes invalidate earlier reduction evidence.
- Only the currently configured marketplace is eligible. Switching marketplace makes old-source task details unavailable for customer outreach.
- The first accepted complete import missing an available/reserved car creates a missing-stock episode. Further misses update that episode; replaying the same import cannot duplicate it.
- Vehicles already missing before this feature was installed are not backfilled as new work. If one returns and later disappears again, that new episode creates a task normally.
- Existing stock-drop, validation, freshness and completeness safeguards remain in force. Rejected/quarantined imports do not change stock tasks.
- Reappearance resolves the missing episode. Imports do not reopen staff-sold, hidden or archived cars.
- Mark reviewed acknowledges the displayed revision only. A conflicting revision returns 409 and requires a refresh. Acknowledgement changes neither the vehicle nor any customer commitment. Reviewed missing episodes do not repeatedly return to Home until the car returns and disappears again.
- Existing publication rules remain: the default is to hide a car after two accepted complete missing observations. Missing is never treated as evidence of a completed sale.

Tasks are stored in `stock_change_tasks`; changes to public price and missing/reappearance status are also recorded in `vehicle_changes`. Reads and writes are dealer-scoped. Reads require staff access; acknowledgement requires `stock.manage`. Task and contact queries are bounded, and urgency ordering happens before the page limit.

## Customer drafts

Prepare draft opens the existing staff-reviewed email composer. It does not automatically save, queue or send an email. Staff choose Save draft or Review email, and sending remains a separate explicit action.

- Price messages describe the advertised price only. Customers with an active agreed sale or paid commitment are excluded from price-update candidates.
- Missing-stock messages say availability is being checked and ask customers to check before travelling. They do not assert sold, cancel a visit or promise a refund.
- Known bounced/complained/suppressed enquiry recipients are excluded from email candidates. Customers without an email can still be contacted by phone or through their history.
- Existing saved recipients, text and attachments are preserved. Stock wording replaces text only when staff explicitly choose it.
- The current task is checked again before Review email and before Send email. Superseded prices, resolved tasks and customers no longer eligible block the stock-update flow while keeping the draft text.
- Customer email permissions and platform email switches still apply. No AI call is needed.

Agreed sale prices, deposit amounts, payment ledgers, issued invoice snapshots and appointments are never modified by the task flow.

## Local preview and validation

`STOCK_CHANGES_PREVIEW=true PORT=4197 pnpm --filter @workspace/luxxy-motors dev:preview` enables two labelled, memory-only local examples against existing preview vehicles/enquiries. Without the opt-in, the preview task API returns an empty list. This preview cannot import stock or contact an email provider.

- API: `pnpm --filter @workspace/api-server test:stock-changes` uses a disposable embedded PGlite database, all migrations and fictional HTTP imports. No production database or external provider is used.
- Frontend: Vitest covers Home, tasks, draft wording, saved-draft preservation and checks before review/send.
- Browser: `playwright.stock-change-tasks.config.ts` covers 320/390/820/1440px with fictional intercepted requests. All application writes are blocked except an intercepted acknowledgement PATCH.

Migration `0045_stock_change_tasks.sql` must be applied before deploying the API. No historical customer emails are created or sent by the migration.
