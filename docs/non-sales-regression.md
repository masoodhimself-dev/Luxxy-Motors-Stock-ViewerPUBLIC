# Non-sales regression review — 23 September 2026

Branch: `codex/luxxy-premium-ui-redesign`. Local preview only; no merge, deployment, production data access or migrations.

## Coverage

Customer routes: homepage/stock, search and filters, sorting, list/card views, vehicle details and galleries, save/compare, sharing and PDF brochures, car finder, general/delivery/warranty enquiries, viewing bookings and booking management, both part-exchange delivery options, missing/empty/error states and navigation. Staff areas: work queue, leads and contact activity, follow-ups, channels and dealership settings. Checked layouts at 320, 390, 768 and 1440 pixels, with existing tests also covering 375, 402 and 1024 pixels. Browser tests check keyboard behaviour, focus, clipping, real interactions and intercepted request payloads.

Sales/deals, signing and customer purchase-document flows were excluded from this review. Real Clerk sign-in and live email/WhatsApp delivery were not exercised. No stock-import screen currently exists in the frontend. Database integration tests for stock/leads/portal were not run: these require a dedicated disposable local test database and perform writes. Public/local fixture APIs and mocked submission responses were used instead.

## Issues fixed

- Blocked or full browser storage could crash the homepage when saving the stock layout preference.
- Missing prices and mileages sorted as zero. Unknown values now sort after known values in either direction.
- Pasted searches with surrounding whitespace or differently spaced registrations could miss vehicles; search now handles these and the VRM field.
- Substring matching could label `None` or other text as Category N/S. A shared parser recognises explicit categories and clear-history values; missing history stays unconfirmed, including in filters and comparison.
- Vehicle stock-fetch failures looked like a missing vehicle. They now offer a retryable loading-error state.
- Comparison lost valid zero-mileage/zero-owner values and retained stale occupied comparison slots when successfully loaded stock became empty.
- Shared vehicle links bypassed the existing preview route, and WhatsApp could label a registration age band as a number plate. Sharing now uses the existing preview route and verified registration formatting.
- Booking cancellation after rescheduling could continue showing the earlier booking response. Both actions now update the canonical cached booking. Removed slots cannot remain selected, and controls are disabled while changing the booking. Temporary lookup errors support retry.
- Navigation to booking from an already-open enquiry did not react to query-string changes. Enquiry type/vehicle context now follows navigation while preserving entered contact details.
- Logging a contact note could clear the lead’s existing follow-up. Unchanged follow-up fields are now omitted from that request.
- Failed follow-up saves hid the editor and draft; failures now remain visible and retryable, and cancelling an edit restores saved values.
- Channel API errors appeared as empty results. They now show a retryable error.
- Initial settings-load failures offered editable fallback defaults that could overwrite saved configuration. Publishing is now blocked until the saved configuration loads.
- The frontend test configuration silently skipped `.test.ts` files. Both TypeScript test extensions now run.
- A PDF test extractor discarded a valid compressed byte before `endstream`, causing a false missing-text failure. It now uses the declared stream length and checks decoding errors explicitly; existing image/content assertions remain.

## Validation

Passed: 169 frontend tests in 26 files; 73 non-sales browser checks; 10 brochure tests; 4 settings-content tests; 2 database-safety tests; full workspace typechecking and all builds. No failures remain in these checks. Fresh homepage, vehicle and lead screenshots are in `docs/screenshots/non-sales-regression/` at 390px and 1440px. Older screenshot directories remain historical captures rather than being overwritten by this test run.

The existing Vite large-chunk warning remains a performance advisory; this review makes no hosting/build-stack migration. No backend runtime, database schema, API contracts, authentication or sales rules were changed.
