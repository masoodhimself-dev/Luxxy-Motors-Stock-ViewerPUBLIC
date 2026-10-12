# Practical website and workspace audit — 12 October 2026

## Implemented improvements

### Customer website

- General enquiries prioritise reply method and required contact fields. Alternate contacts, messages and part exchange remain optional, with draft values retained. A restored-draft notice no longer appears and shifts the form as soon as typing starts.
- Contact/enquiry/saved screens have coherent spacing and surfaces without repeated framing. Stock facts keep explanations with fewer repeated icons. Supplied descriptions, equipment and history remain accessible.
- Clearing saved cars requires confirmation; cancelling retains the shortlist. Duplicate vehicle wording is removed.
- Recently viewed excludes withdrawn vehicles. Missing/failed images disappear while useful car text remains.
- Booking shows seven quick dates, with all later dates in the date selector; a selected later date stays visible. The specific car stays attached.

### Enquiries, dashboard and settings

- Selected enquiry records group customer, car and next-step information. Conversation, follow-up, email and appointment controls are prominent; update, merge, sale and history tools sit under More options.
- Today uses compact timed records and Show all. All records, attendance controls, exception labels and approval actions remain reachable.
- Obsolete viewport grids are removed: fields follow natural page flow, desktop search keeps useful width, and the ribbon wraps. Long optional vehicle references have keyboard-accessible internal scrolling.
- Dashboard shows four priority metrics and practical appointment/payment/delivery tasks. Reporting and healthy-feed diagnostics move under More dealership details. Failures and pending approvals remain visible.
- Owner email branding/variable help use disclosures. The active email integration fills its available width; owner fields have consistent colour, touch size and long-text wrapping.
- Email customer supports reviewed messages, vehicle/appointment details and selected private service-book photos. See [customer enquiry emails](../features/enquiry-customer-emails.md).

### Sales and backend

- Browser and backend share exact decimal-to-pence parsing and ledger totals. Unsafe aggregates, malformed fees/part exchanges and excessive amounts produce validation errors.
- Expandable totals show price, fees, discounts, allowances, received money and remaining balance. Pending payments do not reduce the balance.
- Payment reference/type is optional detail. Fractional pennies, overpayments, future received dates and falsely labelled final payments are checked before saving. Received-payment preview explains the balance and reservation effect.
- Refunds cannot exceed the refundable remainder. Pending types, customer credit, zero-cash and older part-exchange deal statuses are handled accurately.
- Completion/preparation/document rules determine completed/ready status. Empty document controls disappear; agreed disclosures lock after completion. Approved terms, receipt history, tenant isolation, revisions, immutable archives and retries remain protected.
- Email delivery adds a small journal migration; attachment bytes are fetched only for the enquiry's own dealer/car and are not duplicated into the journal. LAN-safe request IDs prevent phone email/upload lockups.

## Optional features flagged, retained

| Feature                                                            | Present decision                       | Possible later consolidation              |
| ------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------- |
| Test drives tab and enquiry Calendar                               | Retain approvals and unified diary     | One calendar with approval queue          |
| Callbacks and Today follow-ups                                     | Callbacks remains secondary            | One daily action queue                    |
| Enquiry stock browser and Cars inventory                           | Quick call lookup remains secondary    | Shared vehicle reference/selector         |
| Conversion statistics/healthy-feed diagnostics                     | Fold into details                      | Optional reporting area                   |
| Classic/blank receipts                                             | Keep optional, previously requested    | Enable only for interested dealers        |
| Private purchase links/extra draft invoice versions                | Keep optional; preserve issued history | Focus on core receipt/invoice workflow    |
| Legacy device sales drafts                                         | Preserve recovery access               | Retire only after migration/confirmation  |
| Autoplay cars/recently viewed/alternate stock views/search sharing | Retain existing behavior               | Use actual usage to choose what to retire |

Existing practical-release policy still withdraws website chat, online card reservations, comparison and recent handovers. This audit does not re-enable them, delete historical records, change Grok schedules/credentials, change domains or alter subscription billing.

## Test evidence and limits

- Public responsive journeys cover homepage, stock, vehicle, booking, contact, warranty, part exchange and saved cars at 320/820/1440 pixels, including draft/error recovery and shortlist confirmation.
- Enquiry/callback/merge checks cover phone/tablet/desktop natural-flow layouts, ad hoc cars, follow-ups, booking exceptions and preserved drafts. Owner settings checks visit every setup step/category; non-owner denial is verified.
- Sales checks cover deposits, pending confirmation, fees, discounts, three part exchanges, split payments, partial refunds, final payments, completion/handover, races, lost responses and archived PDFs. Fifty varied completed deals verify exact totals and immutable receipts.
- Email/inventory checks use fake delivery and isolated databases; actual image compression, reviewed attachments, alias access, cross-dealer denial, stale previews and duplicate requests are tested. Platform onboarding and empty/unavailable public routes receive broad smoke checks.
- Shared/API/frontend TypeScript checks and production builds are release checks. The migration is exercised from a clean isolated database before the existing Render pre-deploy migration.

Testing does not make incorrect staff input impossible, prove email delivery/read status or replace physical Safari/iPhone/iPad checks. No verification test changes live sales, takes money, publishes dealer settings, imports stock or sends real email. Consolidation must preserve essential dealer records and approvals.
