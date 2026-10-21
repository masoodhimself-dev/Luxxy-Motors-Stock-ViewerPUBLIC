# Confirmed sale checks and customer follow-ups

## Final sale checks

The full-invoice review and mark-sold screens show a plain reminder list. Staff do not fill in or save final checklist items, and missing historical final attestations do not block a sale. The existing invoice review, explicit sold confirmation and outstanding-balance acknowledgement remain unchanged.

| Check ID | Staff check |
| --- | --- |
| `customer_vehicle` | Customer and vehicle confirmed |
| `price_payments` | Agreed price and payments checked |
| `disclosures` | Vehicle details and disclosures explained |
| `documents` | Documents reviewed with the customer |
| `handover` | Collection or delivery arranged |

Each effective part-exchange vehicle has its own intake checks in Payments, keyed by uppercase registration without spaces. Completed intake folds away and is not repeated on the final screen. An unfinished intake has a link back to Payments:

| Check ID | Staff check |
| --- | --- |
| `identity` | Registration and VIN checked |
| `condition` | Mileage and condition inspected |
| `ownership` | Ownership and documents checked |
| `finance` | Finance position reviewed |
| `keys` | Keys and agreed items accounted for |

These are staff attestations. The application does not perform a vehicle inspection, establish ownership, check external finance databases or certify legal/safety compliance.

`POST /api/sale-workspace/:id/checklists` requires staff authentication and `sales.manage`. It uses the existing `expectedRevision` and `requestId` guards. Example:

```json
{
  "expectedRevision": 7,
  "requestId": "unique-check-request-123",
  "completion": { "customer_vehicle": "checked", "documents": "not_needed" },
  "partExchanges": [
    { "registration": "AB12 CDE", "items": { "identity": "checked" } }
  ]
}
```

Accepted states are `pending`, `checked` and `not_needed`. The server records the actor and timestamp for each saved attestation and appends sale-history events. Clients cannot supply their own actor/time evidence. Resetting a check to pending removes its current evidence but retains its history.

Only unfinished part-exchange intake checks are enforced on `finish-invoice-sale`, `complete-sale`, `lifecycle: sold` and a first handover that marks a car sold. Preparing an invoice or recording a deposit remains separate. Each part-exchange row needs a distinct registration; two rows cannot share one set of intake attestations. Existing balance acknowledgements, payment validation and stock ownership guards still apply.

Saved intake remains valid when buyer/contact details, the sale vehicle's VIN, payments or the part-exchange allowance change. Replacing the incoming registration or changing its recorded description requires checks for that changed incoming car; other incoming cars retain their saved evidence. The frontend uses the same rule while editing, so unrelated unsaved paperwork edits do not display completed intake as pending. Historical final-check evidence and events remain supported for older clients and stored records, but are not a completion gate.

Previously sold/completed records are not backfilled with invented checks and remain usable for their existing payment and handover operations. Completed evidence cannot be rewritten through the checklist endpoint. Existing issued invoice/document snapshots remain unchanged.

## Other bookings and interested customers

The sale screen previews the car's other enquiry-backed appointments and open enquiries. This is the current portal's customer/booking flow. Legacy standalone records created only through `/api/leads`, with no linked enquiry, are outside this review; no migration or automatic customer-record creation is performed. Marking a vehicle sold creates durable rows in `sold_vehicle_follow_ups` in the same transaction as the stock change. Creating these rows does not cancel a booking, save a draft or send an email.

The review separates remaining test drives from optional updates to interested customers. The linked buyer is excluded, duplicates are grouped without dropping their distinct appointments, and each dealer's data stays scoped to that dealer. Existing sold vehicles are not backfilled as new customer outreach on rollout.

Staff explicitly approve cancellation of the displayed future appointments. Cancellation keeps appointment history, frees the slots, stops reminders and revokes outstanding declaration access. It deliberately does not invoke the ordinary automatic booking-cancellation sender. Staff prepare and approve their customer email separately, through the existing email composer, or record contact by phone. This reviewed email does not attach a calendar cancellation; customers who saved an earlier invite must remove that entry themselves. Internal portal/calendar booking cancellation is immediate after the staff confirmation.

Opening the composer does not send a message. Existing saved text, recipients and attachments remain available for review rather than being silently replaced. The current sold-car review is checked again before email review and before sending. The follow-up row's durable UUID is reused as the reviewed email request ID, so retries or a second staff device cannot silently send a second copy through this flow. The existing email endpoint replays an identical request and rejects different content under an already-used request ID. General interested-customer updates are optional and do not close the enquiry.

Unfinished customer work appears on Home. Missing email details require another contact method. If no usable contact details exist, staff can explicitly record that limitation with a meaningful note; this does not claim the customer was contacted. Moved or merged records remain visible with a manual-review warning, and cannot be cancelled from a stale review. Staff must handle any remaining booking for the sold car before recording where that work was resolved.

Email states distinguish provider acceptance from delivery; a later known failure/bounce returns the work to attention. Cancellation does not roll back a completed sale when an email cannot be sent. Agreed prices, deposits, payments and issued invoices are not changed by this review.

## API and rollout

| Method | Route | Purpose | Access |
| --- | --- | --- | --- |
| `GET` | `/api/staff/sold-vehicle-follow-ups` | Home worklist | Staff |
| `GET` | `/api/staff/sold-vehicle-follow-ups/:saleId` | Preview/current customer review | Staff |
| `POST` | `/api/staff/sold-vehicle-follow-ups/:saleId/customers/:enquiryId` | Explicit cancellation or recorded contact | Staff + `sales.manage` |

Customer actions carry the displayed follow-up revision. Cancelling a grouped customer's visits also requires the current revision of every future appointment. Stale or changed records return a conflict and require staff to refresh the review.

Apply migration `0046_sold_vehicle_follow_ups.sql` before deploying the API. The migration creates storage and indexes only; it sends no emails and cancels no existing appointments. Checklist evidence is stored inside the existing sale workspace JSON and needs no additional columns. No collector schedule, delivery configuration or live stock-worker setting is changed.

## Offline validation

From the repository root:

```sh
pnpm exec tsc --build lib/vehicle-meta/tsconfig.json
pnpm exec tsc -p artifacts/api-server/tsconfig.json --noEmit
pnpm --filter @workspace/api-server test:sale-workspace
```

The sale regression tests use fictional data, injected database clients and temporary local stores. The sold-customer HTTP test uses an embedded disposable PGlite database and records attempted outbound requests; it does not use a production database or real email provider:

```sh
cd artifacts/api-server
node test-enquiry-emails-build.mjs src/sold-vehicle-follow-ups.test.ts
node --test dist-test/sold-vehicle-follow-ups.test.mjs
```

Do not run test builders concurrently against `dist-test`: they clear that directory before building. Local HTTP tests need loopback access; a sandbox restriction on binding `127.0.0.1` is an environment failure, not a reason to remove the HTTP assertions.

The actual sales screen also has browser coverage with fictional intercepted requests at 320, 390, 820 and 1440px:

```sh
pnpm --filter @workspace/luxxy-motors exec playwright test --config playwright.sale-checklists.config.ts
```

The browser suite covers non-editable reminders, retained intake, the link back to Payments, shared intake-rule errors, no horizontal overflow and unchanged invoice/payment JSON. It blocks every unexpected application write. Supporting HTTP regression tests exercise the actual local preview route's explicit sold confirmation without final checklist writes, preserving retry, revision, origin and immutable invoice/payment rules.
