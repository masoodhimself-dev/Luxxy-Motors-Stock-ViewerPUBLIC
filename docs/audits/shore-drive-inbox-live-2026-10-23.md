# Shore Drive Inbox end-to-end audit — 23 October 2026

## Scope and release status

Live Shore Drive was tested through the signed-in browser using Masood’s previously approved test email and telephone number. WhatsApp was tested as a handoff only; no actual WhatsApp message was transmitted. Invoice changes are on `codex/invoice-whatsapp-audit` and are **not deployed**. No migration is needed.

## Live results

| Check | Result |
|---|---|
| Quick Enquiry | Created labelled TEST customer and Hyundai ix35 enquiry; correct contact, vehicle and staff assignment |
| Outgoing email | Internal email composed, reviewed and sent; actual delivery verified in signed-in Gmail |
| Incoming reply | Replied from Gmail; received in the original Hyundai enquiry, without attaching to other enquiries sharing the contact details |
| Attention counts | Incoming reply raised Needs reply from 1 to 2; staff acknowledgement restored 1 |
| WhatsApp | Recipient normalized to +44; reviewed message preserved in handoff; controlled staff-confirmation test saved to the original enquiry |
| WhatsApp confirmation honesty | Test message explicitly states no actual WhatsApp send; UI records staff-confirmed, delivery not independently verified |
| Staff booking | Saved 24 October 11:00 UK for the same contact and Hyundai; booking share included correct appointment facts |
| Booking cleanup | Cancelled test appointment through the normal UI; confirmed Visit cancelled, no follow-up scheduled and Test drives count 0 |
| Deposit invoice | QR prepared successfully with correct customer phone and immutable deposit PDF link; not sent or marked sent |
| Full invoice | Reproduced disabled button when issued invoice snapshot has Road Tax guide selected |

Controlled enquiry: `7db73642-ffb9-4817-9ae1-aaf82ee10b3c`. Cancelled booking: `82ec22c7-27d6-4679-bcd3-8b5867a8eb00`. The booking intentionally creates a separate enquiry under existing booking rules; it retained the correct contact and vehicle. Existing customers, stock, schedules, payments, sale and issued invoices were not modified.

Public scheduling is switched off in Shore Drive Settings. Quick Enquiry correctly disables its booking toggle. The staff manual booking path was tested with an explicit outside-hours exception; overlapping/full-day override stayed off. Public scheduling was not enabled.

## Invoice cause and fix

Three sales screens hide/disable WhatsApp when a full invoice has its email Road Tax guide selected, unless the transient green-slip reference is entered. Saved paperwork provides no adjacent reference entry or explanation. The server also calls the invoice-email attachment helper, unnecessarily requiring that reference to prepare WhatsApp.

WhatsApp now shares the existing archived PDF only, without a green-slip reference. The tax guide remains exclusive to emailing an invoice, as previously requested. Email guide validation and attachment generation remain unchanged. No financial calculations, permissions, snapshots or archives changed.

## Verification

- Sales and ShareQr component tests: 57 passed.
- Isolated media/sharing HTTP and migration tests: 33 passed, including tax-guide-selected full invoice, exact archived PDF, one file, no sending, dealer isolation and confirmation history.
- Customer reply routing/attention tests: 12 passed.
- Invoice email attachment tests: 3 passed, including preserved green-slip requirement.
- Real Chrome responsive Inbox tests: 3 passed at 390, 834 and 1440 px.
- Full workspace typecheck and production build passed (existing bundle-size/sourcemap warnings).
- Corrected an outdated test-only migration fixture so the enquiry-photo upgrade test is scoped to its migration rather than assuming it remains the latest migration. Production migration files unchanged.

## Limits

The full invoice fix has not been verified on Render because it is not deployed. Real WhatsApp delivery and physical iPhone/iPad behavior were not tested; automated responsive checks use Chrome. The test appointment and enquiry remain clearly labelled as audit history; no permanent deletion was performed. Private sharing URLs and reply-routing tokens are intentionally omitted.

## Follow-up release audit

The invoice fix was published to the Render release branch and deployment `dep-dbdmmauq1p3s7394vib0` was triggered for commit `16804f442db1093ed5d56e33fdda5ef2cbd318d3`.

Expanded component coverage: 116 passed (Quick Enquiry, phone sharing, internal email fallback, sales and ShareQr). Expanded browser coverage: 20 passed, covering booking retries, duplicate submission prevention, changed cars/dates, approval status, unavailable slots and responsive Inbox/booking screens. Existing test assumptions were updated for reference-free calendar filenames, current recovery wording and available fictional stock. These are test-only changes; booking eligibility rules remain unchanged.
