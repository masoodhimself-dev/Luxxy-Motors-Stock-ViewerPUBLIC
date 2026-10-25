# Guided test-drive design installation — 25 October 2026

Implemented Direction 01 from the revised local design review as React/CSS, retaining the existing API hooks and shared solid icons. No prototype scripts, timers, fixtures or booking mutations were copied into production.

## Changes
- Customer booking: wider two-column layout, compact mobile vehicle summary, five quick dates plus a selector containing every permitted date, clearer progress and date/time headings, collapsible showroom and visit instructions.
- Customer booking management: matching spacing and compact vehicle photo treatment; absent photos do not reserve an empty column.
- Staff appointments: selectable appointment list on larger screens and a native appointment picker on phones, one detailed record at a time. Existing attendance, revision guards, approval, declaration, WhatsApp, email and merge controls retained. Only the selected preparation is loaded, rather than loading preparations for hidden appointment rows.
- Dealer theme variables, existing typography and icons retained. Backend, schema, payment and message delivery rules unchanged.

## Verification
- Frontend typecheck passed.
- Full frontend Vitest suite: 193 files, 2,047 tests passed.
- Production frontend build passed (existing sourcemap and chunk-size warnings).
- Browser: local production components at 390×844, 820×1180 and 1440×1000; customer booking and staff selected appointment views fit without horizontal page overflow.
- Browser: chose available date/time, entered fictional contact details, reached review without submitting; customer details preserved.
- Browser: switched selected staff appointment and checked customer/email links point to the selected record.
- Existing regression tests cover failed rechecks, preserved contact details, cancellation/rescheduling failures, contextual appointment isolation and permissions.
- Physical iPhone/iPad Safari testing is outstanding. No real bookings or customer messages sent. No deployment performed.

Local preview: http://127.0.0.1:4216/enquire?type=viewing&vehicleId=27be77df-87ce-4557-8b61-0a24d9092b76
Screenshots: output/test-drive-design-review-2026-10-25/installed/

## Follow-up: background and date control defects

The first visual check missed a real surface mismatch and a clipped native date control. Both were reproduced in the running app before correction:
- Page computed background: rgb(245,246,247); the active form was rgb(255,255,255), leaving an unframed white rectangle.
- Date selector constrained to 190px while displaying full labels such as Tuesday 27 October.

Corrections:
- Booking page uses the dealer card surface throughout; active form background is transparent. Removed obsolete booking backgrounds, card decorations and seven-column date rules from customer-workflows.css, so route stylesheet order cannot restore them.
- Native selector uses compact dates (Wed 18 Nov), a responsive 140–160px column and reserved arrow space. The full selected date remains above the times.
- Five quick dates now form a consecutive window around the selection. Selecting November no longer appends one November date to four October dates.

Verification:
- All 3 booking steps inspected in the local browser at 320×812, 390×844, 820×1180 and 1440×1000. Page scroll width equals viewport width in all 12 states. Details retained through review.
- Opened native date dropdown; selected later November date, confirmed selected quick date and times use that date. Verified return navigation retains corrected surface and five date columns.
- Background measured white across the page and transparent in the active form at all 4 widths; dealer theme tokens retained.
- 40 focused tests passed across customer booking, booking management, staff appointments and general enquiry. Added regression covering all permitted selector dates, compact labels, later contiguous date window and matching availability date.
- Typecheck and production build passed; existing chunk-size/sourcemap warnings remain.
- Screenshots and measurements: output/test-drive-design-review-2026-10-25/visual-fixes/.
- No appointment submitted, no messages sent, no deployment. Physical-device native picker testing remains outstanding.
