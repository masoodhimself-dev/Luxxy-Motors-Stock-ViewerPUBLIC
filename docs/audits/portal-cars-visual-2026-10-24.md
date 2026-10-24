# Portal and Cars visual audit — 24 October 2026

Branch: `codex/portal-cars-visual-audit`. Deployed with user approval.

## Live release

- Commit `0de3b98841a98776139105a57b6761cfe7c118d3` fast-forwarded to `codex/multi-tenant-foundation`.
- Render deployment `dep-dbe11vbrjlhs738m2q30` reached `live` on 24 October 2026 at 02:03:55 UTC (03:03:55 UK).
- Shore Drive and Luxxy health endpoints both returned `status: ok`. No error-level logs were returned for the checked release interval.
- Verified Shore Drive's live Cars list has no preparation controls or progress. Opened a car and switched through Photos & video, Description and Customers successfully, then returned to the list. This was read-only; no record, stock or customer-message changes were made.
- No new migration, environment variable or credential was required. Physical iPhone/iPad testing remains for the operator.

## Inspected

Running local portal: Home, Cars list and car details, Sales list, Reservations, History and Settings. Browser checks at 390, 834 and 1440 pixels, plus the scoped photo-upload workflow at 390, 820 and 1440. Screenshots reviewed at phone, tablet and desktop widths. Browser emulation does not replace physical-device testing.

## Findings and changes

- Removed the preparation interface entirely from Cars as requested: checklist, progress bars, preparation filters/sort, staff assignment, target dates and preparation-save prompts. Existing stored records and backend compatibility fields were not deleted; no preparation writes are made by Cars.
- Separated car details into Photos & video, Description and Customers. Default media view keeps private-photo controls accessible; editors remain mounted so changing sections does not discard their state.
- Reduced empty header space and styled heading tools to wrap correctly. Increased phone supporting text to 12px; the two remaining car-check filters now both fit on screen.
- Used existing colours for availability and attention: green/available, amber/reserved or plate attention, blue/private photos, teal/selected car section. Text labels accompany colour. Home task badges now use existing semantic task colours.
- Raised Home, history and contact targets to 44px, made meaningful secondary text easier to read, and strengthened focus outlines using the existing portal accent.
- Fixed customer-load failures being presented as an empty customer list: explicit error, disabled chooser and retry instead of prompting another enquiry.
- Hid the customer-page link for sold, hidden, source-missing and archived vehicles using the existing advertised-car predicate.

## Verification

- All 1,880 frontend tests passed across 182 files, including 26 updated Cars tests.
- Seven browser tests passed: all six portal sections at three responsive widths; car-section selection; absent preparation controls; no horizontal overflow or page errors; scoped phone QR/photo compression and upload.
- Portal audit browsing blocked all writes; the dedicated upload test used fictional intercepted endpoints. No live dealer records, payments, stock, customer messages or settings were changed.
- Typecheck, production build and diff checks passed. Existing bundle-size and sheet sourcemap warnings remain non-fatal.

## Limits

This pass verifies the primary screens and the changed Cars workflows. It is not an exhaustive audit of every nested settings form, booking outcome or sales workflow. Those existing rules and APIs are unchanged. Real camera hardware, actual WhatsApp sending, production load and live dealership permissions were not retested.
