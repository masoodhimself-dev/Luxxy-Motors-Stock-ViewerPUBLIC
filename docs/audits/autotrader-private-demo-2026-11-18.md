# Auto Trader private demo review — 18 November 2026

Prepared from shared release `fa98763c8bfabf7b0f48b541454261e425a4d8fa` on `codex/autotrader-demo-details`. This work is local and has not been deployed.

## Behavior

Pasting an Auto Trader dealer page or retailer stock link now offers the same JSON, logo and public dealership-details review as Cazoo. The generated prompt asks for verified public contact details, address and opening hours. Missing fields remain optional. Existing automatic stock collection is a separate folded option and retains its original job flow.

The authenticated server accepts optional stock, logo and dealership details at the Auto Trader demo endpoint. It validates retailer identity, completeness, source links and upload limits, and imports into a separate private draft transaction. Replay preserves omitted settings. Existing live dealerships are not upload targets. The previous 8 KB body parser was removed; both marketplace uploads have a bounded parser for the stock and logo envelope.

## Private visual review

The local review uses Shore Drive's published Auto Trader-fed stock (authorised retailer `10040438`) and its published website settings. It retains the source collection time `2026-11-18T17:39:32.429Z`: 19 cars and 920 photo references. This is an export of the existing public catalogue, not a new marketplace collection.

The public logo, telephone, email, address and opening hours were read from the dealership website. The preview's JSON import was exercised through the browser, and vehicle and contact pages were inspected at 1440 × 1060 and 390 × 844. Screenshots and the public input JSON are local, under `output/autotrader-demo-2026-11-18/`, and are not included in this source change.

The opt-in Vite review handler accepts only the prepared stock fixture on loopback, with same-origin checks and no production database connection. Production authentication and persistence are tested separately using the existing isolated integration database.

Public stock and dealership-settings responses were compared before and after the local test; both were unchanged. No live stock, account, feed, reservation, enquiry or sales records were written.

## Validation

- Frontend: 30 focused tests, frontend typecheck and production build passed.
- API: full Platform suite (10 tests), upload-admission suite (7 tests), API typecheck and production build passed.
- The production app regression accepts parsing a 500 KB request before enforcing authentication, and rejects oversized advertised bodies without waiting for their contents. It covers both marketplaces.
- The actual 506,044-byte Shore Drive export passed the real stock schema, snapshot checker, dealership-details and logo validators. Blank optional map links are accepted; malformed source URLs return validation errors rather than throwing.
- Independent review found no outstanding release blocker. The user-facing preview is still local; production deployment is a separate step.
