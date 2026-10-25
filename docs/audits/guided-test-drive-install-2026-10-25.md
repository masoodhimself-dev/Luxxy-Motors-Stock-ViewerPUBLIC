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
