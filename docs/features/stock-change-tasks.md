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

Tasks are stored in `stock_change_tasks`; changes to public price and missing/reappearance status are also recorded in `vehicle_changes`. Reads and writes are dealer-scoped. Reads require staff access; acknowledgement requires `stock.manage`. Per-customer outcomes require `sales.manage`. Task and contact queries are bounded, and urgency ordering happens before the page limit. Each task includes accurate `customerTotal` and `pendingCustomerTotal` counts across all eligible customers before the 100-contact display limit. Pending and follow-up outcomes appear before completed contacts, so finishing the current rows exposes the next unfinished customer instead of stranding older enquiries.

## Customer drafts

Contact customer opens the contact options. Email and WhatsApp open the existing staff-reviewed message composer. They do not automatically save, queue or send a message. Staff choose Save draft, Review email or WhatsApp QR; sending remains a separate explicit action.

- Price messages describe the advertised price only. Customers with an active agreed sale or paid commitment are excluded from price-update candidates.
- Missing-stock messages say availability is being checked and ask customers to check before travelling. They do not assert sold, cancel a visit or promise a refund.
- Known bounced/complained/suppressed enquiry recipients are excluded from email candidates. Customers without an email can still be contacted by phone or WhatsApp.
- Existing saved recipients, text and attachments are preserved. Stock wording replaces text only when staff explicitly choose it.
- The current task is checked again before Review email and before Send email. Superseded prices, resolved tasks and customers no longer eligible block the stock-update flow while keeping the draft text.
- Context persists through saved Inbox drafts, email fallback and queued email retries. Price QR codes open a checked phone preview and recheck the current price and recipient immediately before WhatsApp opens. Historical drafts without task provenance remain ordinary drafts.
- Customer email permissions and platform email switches still apply. No AI call is needed.

Agreed sale prices, deposit amounts, payment ledgers, issued invoice snapshots and appointments are never modified by the task flow.

## Local preview and validation

`STOCK_CHANGES_PREVIEW=true PORT=4197 pnpm --filter @workspace/luxxy-motors dev:preview` enables two labelled, memory-only local examples against existing preview vehicles/enquiries. Without the opt-in, the preview task API returns an empty list. This preview cannot import stock or contact an email provider.

- API: `pnpm --filter @workspace/api-server test:stock-changes` uses a disposable embedded PGlite database, all migrations and fictional HTTP imports. No production database or external provider is used.
- Frontend: Vitest covers Home, tasks, draft wording, saved-draft preservation and checks before review/send.
- Browser: `playwright.stock-change-tasks.config.ts` covers 320/390/820/1440px with fictional intercepted requests. All application writes are blocked except an intercepted acknowledgement PATCH.

Migration `0045_stock_change_tasks.sql` must be applied before deploying the API. No historical customer emails are created or sent by the migration.

## Per-customer price follow-up

A price task now records each eligible enquiry's outcome independently: Pending, Contacted (phone/email/WhatsApp), Not needed, or Follow up later. Each write includes the task revision and customer outcome revision. Changes to another dealer, a stale price/task, an ineligible customer, or a concurrently changed outcome are refused. The task cannot be marked reviewed while any eligible customer is Pending or Follow up later. Missing-stock review behaviour remains unchanged.

Phone calls and explicit staff confirmations are recorded in that enquiry's private conversation history. Successful internal email sends and staff-confirmed WhatsApp sends also complete the relevant price outcome through an idempotent confirmed-contact event. Saving a draft, opening a QR code, preparing a WhatsApp message, or a failed email never counts as contact. Replaying the same confirmed-send event neither duplicates contact nor restarts the contact interval.

Follow up later writes a real enquiry reminder so it remains visible on Home if the price changes again or the car disappears. It never replaces a separate unfinished customer callback; staff are directed to review that enquiry first. Completing a price contact only completes the reminder belonging to that task. These actions do not alter appointments, sales, deposits, invoices, or payments.

## Private price-update preferences

`GET /api/staff/stock-change-settings` returns `{minimumReduction, contactIntervalDays, revision}`. Defaults are £100 and 7 days. `PUT` requires `settings.publish` (owner), the displayed revision, an integer minimum reduction between £0 and £1,000,000, and an interval from 0 to 365 days. Zero disables that filter. These are private staff preferences, independent of public website settings and publication.

A genuine published price decrease is still recorded and still supplies the 14-day customer badge even below the minimum reduction. Only the non-urgent Home outreach prompt is filtered; upcoming visits, paid commitments and explicitly planned customer follow-ups remain visible. Raising the minimum later cannot hide a callback staff have already committed to. The current task detail always reports the preferences and each customer's suggestion status. `availableForPriceUpdate` separately confirms that the current price task and vehicle are available for outreach; a reserved car can remain publicly visible and available for staff review while this value is false.

The contact interval applies to confirmed price contacts for the same dealer and vehicle, matching the enquiry or the stored normalized email/phone. A later drop shows when that customer was last contacted and when the interval ends. Phone matching normalizes UK local, +44 and 0044 formats consistently when excluding agreed buyers and paid commitments. Repaired historical confirmations retain their original contact time and never overwrite a newer staff outcome or callback. It suppresses the suggestion, not an explicit staff decision. No message is sent automatically.

`PATCH /api/staff/stock-change-tasks/:id/customers/:enquiryId` accepts:

```json
{
  "expectedRevision": 0,
  "expectedCustomerRevision": 0,
  "action": "follow_up",
  "followUpAt": "2026-10-27T10:00:00Z",
  "note": "Check whether they are still interested."
}
```

For `contacted`, supply `channel` as `call`, `email`, or `whatsapp` and omit `followUpAt`. For `not_needed`, omit both. The response is the refreshed task, including per-customer outcome revisions. Invalid input returns 400, missing/foreign tasks return 404, and stale or conflicting work returns 409.

Migration `0053_stock_change_customer_outcomes.sql` adds private preferences, per-task/customer outcomes and idempotent confirmed-contact records, with dealer-scoped foreign keys. It changes no historical prices or customer commitments and sends no messages. Apply it before deploying this feature; do not run it against live data as part of a local test.
