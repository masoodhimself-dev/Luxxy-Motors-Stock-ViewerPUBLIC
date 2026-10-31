# Public one-page vehicle sheet

The vehicle page’s Print vehicle details action prepares an isolated A4 preview. Customers can print the sheet, download the same design as a PDF, or select Ink-saving.

Opening the dialog checks the current dealer-visible vehicle once. Failed, sold, removed, mismatched or malformed responses block output with an explicit retry. The sheet uses freshly returned price, description, equipment and photos rather than old page props. Changing print colour does not recheck stock. No polling is added.

An optional cache-only MOT read has a separate 2.5-second limit. Only matching, recently checked records can supply an unexpired latest-pass date or provider-supplied first due date; unavailable data is omitted. Printing never triggers a DVSA lookup.

The shared Auto Trader/Cazoo mapper retains the canonical exact-car QR, vehicle facts, complete material disclosures, confirmed inclusions and dealer contact/hours. Optional text is shortened with ellipses, equipment is prioritised, and technical costs are summarised. The measured renderer preserves the 10pt body minimum and one A4 page.

PDF export is loaded only when requested. It renders the prepared DOM at 300dpi using the isolated iframe’s own fonts, keeps canonical links clickable and applies monochrome to photographs. Closing or switching vehicles cancels pending work. A failed export leaves browser printing available.

The read-only photo endpoint accepts only an exact current vehicle image on the two approved source CDNs. It uses existing pinned-public-DNS/TLS/no-redirect raster fetching, quotas, concurrency limits and a bounded memory cache. No arbitrary image URL, customer data, stock mutation, settings, invoice or payment change is introduced.

## Verification

- Isolated release: 1,854 frontend tests passed under the project’s Node24 runtime.
- Final focused tests after font and optional-MOT hardening: 34 passed.
- Image endpoint tests: 6 passed against isolated fixtures; no live writes or providers.
- Responsive browser checks: 17 WebKit cases covering both feeds at 390, 834 and 1440px, including an actual phone PDF download, freshness failures/retry and cached MOT states.
- Two Chromium downloads checked for one A4 page, canonical links, print typography and ink-saving pixels; QR verification recorded with QA artifacts.
- Frontend/backend/shared typechecks and both production builds passed.

No invoice renderer or database migration is included in this release. Existing records, financial documents, stock schedules and message sending remain unchanged.
