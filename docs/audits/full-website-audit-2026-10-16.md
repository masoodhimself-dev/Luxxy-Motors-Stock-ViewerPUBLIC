# Website and dealer workflow audit — 16 October 2026

This pass inspected the customer website, dealer portal, sales/invoices, bookings, email, shared tenant boundaries and demo automation. It fixes reproduced defects; it is not a claim that every possible production state is error-free.

## Fixed

| Area | Reproduced problem | Result |
| --- | --- | --- |
| Sales photo | The newly added enlargement dialog appeared beneath the full-screen invoice workspace. The hover card could remain over the dialog. | Dialog uses the established sales layer, hides the hover preview while open, and restores keyboard focus to the photo. |
| Enquiry photos | An images-only vehicle had no preview if heroImage was missing; a failed URL also hid later replacement photos. | Existing thumbnail fallback is used, with failed-state tracking per URL. |
| Enquiry availability | Known sold/archived cars displayed “Availability unconfirmed”. | Their actual known state is shown. |
| Rebooking | Cancelled appointments retained their historical date but lost the Book action. | Staff can book another test drive while retaining the original history. |
| Booking dates | Quick-date labels used the visitor timezone and the available-day list remained stale across London midnight. | London dates and labels are used and the date list refreshes. |
| Booking availability | A failed availability refresh could leave Continue/Confirm enabled with cached slot data. | Submission stops until the time can be rechecked; customer details remain. |
| Customer enquiries | Fullscreen-gallery Message and reserved comparison enquiries scrolled down to an inline form. | Both open the existing car-specific enquiry route. |
| Private booking links | Viewing pages lacked the private response headers and their tokens could be included in request URLs/canonical metadata. | No-store/no-referrer/noindex protections cover viewing pages and API responses; client metadata excludes the token; request-log URLs redact current and legacy capability tokens. |
| Demo completion | Permanent sender/provider 4xx rejection was flattened into a temporary error and retried automatically. | Typed status-only provider errors stop permanent failures; 429 remains retryable. Upstream bodies/credentials do not enter job history. |
| Shared branding | A portal-denial response and payment CSV filename hard-coded Luxxy. | Shared, neutral wording and filename. |
| Test drift | A selling-points test still required the TfL wording explicitly removed by the owner. | Test now verifies the approved absence, without restoring the removed message. |

## Verification

- Full frontend suite: **83 files, 557 tests passed**, with two workers.
- Backend: **239 tests passed** across isolated calculation, settings, brochure/PDF, reservation, booking, email, access, enquiry, relationship, chat, tenancy and platform suites. These include immutable financial records, retry behaviour and guarded tenant access.
- Workspace TypeScript checks passed.
- Focused sales/photo checks passed after the last hover/dialog adjustment.
- Private-header and URL-redaction checks passed after the final token-redaction extension.
- Initial high-concurrency UI runs timed out under resource contention. Repeats with one/two workers passed; the only reproducible old assertion was the removed TfL text described above. Assertions were not weakened to hide timing failures.
- Browser inspection used the isolated local preview: phone homepage/stock/vehicle/sales at 390 CSS pixels, tablet enquiries at 820 CSS pixels, and desktop invoice/photo at 1440 CSS pixels. Checked routes had no document-level horizontal overflow; inspected customer routes reported no browser-console errors. The enlarged photo was visually confirmed over the invoice workspace.

## Limits and follow-up

- No disposable PostgreSQL server/client binaries were available locally. The destructive PostgreSQL stock, sales, leads, portal, migration and reservation integration suites were **not run** against a real server; live databases were not used as a substitute. Run those suites on a disposable PostgreSQL test service before treating this as a full database release gate.
- Browser-spec source expectations for direct gallery enquiries were updated; the standalone Playwright browser suite was not executed in this pass. Responsive checks used the connected browser and existing DOM tests.
- No real email, customer booking, stock import, invoice issue, payment, secret change or dealer schedule was triggered by this audit. UI invoice inspection was unsaved and local only.
- No blanket production certification, penetration test, exhaustive accessibility certification or guarantee of zero remaining defects is implied by these checks.
