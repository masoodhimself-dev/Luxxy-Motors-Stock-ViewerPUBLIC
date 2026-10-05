# Dealer operations

The portal dashboard reads `/api/dealer-operations`. Balances come from the sale payment ledger: confirmed payments reduce the balance, confirmed refunds increase it, and pending payments do not count as money received. Enquiry conversion counts each linked enquiry once, even if several sale files refer to it. Delivery work remains open until its handover is completed.

## Staff access

Clerk supplies the registered account identity. Portal roles are kept in `portal_users` and checked by the API on every protected action.

| Role | Allowed work |
| --- | --- |
| Owner | All sales, payments, refunds, handovers, published prices, website settings, integrations, accountant exports and team management |
| Salesperson | Sales, enquiries, appointments, payment recording and handovers |
| Accounts | Read portal records, record and confirm payments, refund payments and export the payment ledger |

`GET /api/staff/access` supplies the current role and permissions. Owners manage the team through `GET /api/staff/team`, `POST /api/staff/team` and `PATCH /api/staff/team/:id`. Adding staff requires an existing registered Clerk account, identified by email or Clerk user ID; adding a portal role does not send an invitation email. Disabling access preserves the staff record so the account cannot claim access again through an email allowlist. The last active owner cannot be disabled or demoted.

A newly claimed portal grants owner access to the first authorised account. Additional accounts admitted by `PORTAL_STAFF_EMAILS` receive the salesperson role. Migration `0017_staff_roles_settings_history.sql` preserves the earliest existing account for each dealer as owner and gives additional legacy accounts salesperson access. Review and promote additional owners explicitly after deployment. The migration is prepared in this repository and is not automatically applied by the application.

## Website publication history

`GET /api/dealer-settings` returns the existing public JSON contract with an `x-settings-revision` response header and matching ETag. Settings clients must include that revision as `If-Match` when publishing. Missing revisions return 428; stale revisions return 409 without changing the published site.

Owners read history through `GET /api/staff/settings-history`. `POST /api/staff/settings-history/:revision/restore`, with the current `If-Match` header, publishes a new version containing the selected previous settings. Restoration preserves the history and validates reservation terms, appointment policy and visible featured cars. The configuration and its history record commit in one database transaction. Private integration keys are stored separately and are never included in this public settings history.

## Callbacks and conversation history

The vehicle call dialog accepts a callback with a name and phone number; email is optional. `POST /api/enquiries` with `requestCallback: true` creates a general enquiry linked to that vehicle, with source `website_callback`, phone as the preferred contact and no appointment. The server chooses the due time from the dealership's stored showroom hours in `Europe/London`: now while open, or the next known opening while closed. Missing or ambiguous hours leave the request unscheduled so staff can choose a time. Customer input cannot set staff ownership or its own callback due time.

The enquiry workspace's **Callbacks** tab combines website callback requests and outstanding staff follow-ups. It shows overdue, upcoming and unscheduled requests, including unassigned work in the staff member's queue. Staff can claim a record, log a conversation, manage the follow-up, inspect the car, book a test drive or start a sale from its selected detail pane.

`POST /api/staff/enquiries/:id/conversations` requires sales permission, the current workspace and follow-up revisions, a note and an outcome. It appends a dated event with the authenticated staff identity; earlier customer messages and staff notes remain intact. An optional next follow-up is saved atomically with the event. Without one, an existing follow-up remains unchanged; staff mark it completed through **Manage follow-up**. Conversation notes also appear in the linked customer and vehicle histories. Apply migration `0019_enquiry_conversations.sql` before using this endpoint in production; it has been prepared but not run during development.

## Stock monitoring

The existing authenticated Grok stock import endpoint remains the integration point for a scheduled external importer. `/api/staff/stock-health` shows recent import outcomes, validation errors and the last complete successful update. A failed or quarantined import raises a portal warning while retaining the previous valid stock. Freshness uses the snapshot's scrape time, so sending an old snapshot again cannot make stale stock appear fresh.

`STOCK_STALE_AFTER_HOURS` controls the warning threshold and defaults to 36 hours. Scheduling and the importer's credentials belong to the external stock service; this application does not create an external schedule or send external alerts without those details. Owners can set or clear a published price override with `PATCH /api/staff/vehicles/:id/price`; the change is recorded in the vehicle audit history.

## Accountant export

Owners and accounts staff download `/api/dealer-operations/payments.csv`, optionally using inclusive `from=YYYY-MM-DD` and `to=YYYY-MM-DD` filters. Each recorded payment, refund and reversal has its own row, including its confirmation status, signed amount, original payment link, receipt number and recorded staff member. The export escapes commas, quotes and newlines and neutralises spreadsheet formula markers in customer and provider strings.

## Local preview

The local review service stores its team, history and price overrides in `.local/dealer-operations-preview.json`, separately from deployed data. It enforces the same permission rules and settings revision checks. It accepts only the configured local network and same-origin requests. Preview tests use temporary files and injected sale, enquiry and settings readers; they do not connect to a database or provider.
