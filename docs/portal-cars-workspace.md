# Staff Cars workspace

The Cars workspace uses the authenticated, read-only `GET /api/staff/cars` aggregate. Public stock APIs and customer-facing MOT presentation are unchanged. Staff reads are scoped to the verified current dealership, and sale summaries are returned only with the existing `sales.manage` role grant. No new permission, credential, dependency or migration is needed.

## Staff workflow

- Current, Available, Reserved, Sold and Missing from feed views separate actual sale status from source availability. A sold car stays sold even when its source is missing. A reserved car missing from the feed remains in Reserved as well as Missing, with both labels, so its customer commitment stays visible.
- Photos and vehicle names open bookmarkable `/portal?section=cars&carId=…` vehicle files. Search/filter/sort values stay in the URL; returning restores the list position. Quick view supports previous/next cars and returns keyboard focus to its opener.
- Vehicle files reuse the existing gallery, specifications, description, customer history, MOT and sales/booking workflows. Missing and sold cars have no customer-advert or brochure link.
- Customer summaries count explicit enquiry cases. Merged child replies keep their original enquiry ID when opened. Reply, follow-up, appointment and existing-sale actions use actual saved records. New enquiry, booking and sale actions use the existing prefilled forms and existing availability/permission checks.
- Mobile search remains accessible; Filter & sort exposes secondary controls. iPad and desktop layouts use the available space without horizontal page scrolling.

## MOT

List badges read only existing, unexpired DVSA cache entries in one batch. Opening Cars performs no DVSA lookups. Staff explicitly request a check in the vehicle file; existing server-side cache, credentials, limits and permissions apply.

Green means more than six calendar months until expiry; amber means six months or less, including the expiry day; red means expired or a latest failed test. Unknown, malformed, future-dated and stale records stay grey. Every badge includes text and an available date, so colour is never the only indication. First-MOT due dates require recorded DVSA information and are not inferred from the registration year. Staff see full test results; customer-facing presentation is unchanged.

## Feed and changes

The status line separates receiving a file from applying it. Official Cazoo checks link the file hash to a completed import before claiming success; failed, blocked or unapplied files need review. A check older than 36 hours is marked overdue. Refresh screen reloads saved stock; it does not trigger an SFTP download or alter the supplier schedule.

Changes use existing import history, with explicit arrival/photo/detail audit entries added by the official Cazoo importer. Replayed files write no repeated change entries. A newly observed unchanged official file does not repeat the preceding import's change labels. Catalogue edits remain feed-controlled; the staff view does not introduce price, availability or advert-edit mutations.

## Verification

- `pnpm --filter @workspace/api-server test:staff-cars`: MOT boundaries, first due dates, stale/malformed data, source application/age, dealer-scoped aggregate reads, role redaction and the real authenticated reader against isolated PGlite.
- `pnpm --filter @workspace/api-server test:cazoo-feed`: transactional importer and new genuine-photo-change/replay regression.
- Frontend Vitest suite: Cars URLs, tabs, filters, actual merged reply IDs, permission gates, honest loading/error states, booking restrictions and existing portal/form regressions.
- `pnpm exec playwright test --config playwright.portal-cars.config.ts`: Cazoo and Auto Trader fixtures across 320px phone, iPhone, iPad portrait/landscape and desktop. Requests that would save/send are blocked; tests open and discard booking/sale forms only.
- `pnpm run build`: application/library types and production builds.

Physical iPhone/iPad testing and live deployment are separate from the local WebKit checks. No real records or customer messages are involved in these tests.
