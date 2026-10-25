# Settings usability and regression audit — 25 October 2026

Branch: `codex/settings-audit-2026-10-25`. Changes are local; this audit does not deploy them.

## Scope and live result

Audited the Settings editors, persistence/versioning, customer-facing consumers and relevant website/portal regressions. Browser inspection used the real Shore Drive application and a loopback-only local preview with fictional data. Local email/payment requests were disabled or mocked. No real customer messages, stock imports or payment changes were made.

Shore Drive's immediate booking failure was reproduced: online booking was off and all seven appointment days were disabled. Attempting to enable it failed the existing policy validation. Used the already confirmed showroom timetable, explicitly previewed it, and published Monday–Saturday 10:00–18:00 with Sunday closed. Duration, capacity, notice and confirmation rules were retained. The live customer booking form then returned Monday 26 October slots from 10:00 to 17:30. No appointment was submitted.

## Fixes

| Finding | Result |
| --- | --- |
| Booking could be enabled without explaining that every appointment day was closed | Immediate, single timetable guidance with an explicit showroom-hours preview and a link to appointment days; no silent schedule changes |
| Simple booking changes required Website review and publish | Booking-only edits have one **Save bookings** action. Mixed edits still require review of the complete shared draft |
| React Query reused equal JSON and lost its HTTP publication revision | The handwritten Settings query wrapper preserves revision metadata; repeated saves no longer cause a false stale-version error |
| A clean editor could retain an old publication; a dirty editor could encounter changed data | Clean editors adopt current data. Dirty drafts remain intact and conflicting publications cannot overwrite newer settings |
| Settings response caching and inconsistent restore headers | Settings/history use `no-store`; restores return matching revision and ETag headers |
| Public links accepted by direct API calls could bypass editor validation | Publication and restoration reject unsafe, malformed and credential-bearing public URLs. Existing saved data is not rewritten |
| Invoice WhatsApp QR was still offered despite the requested restriction | New invoice sharing defaults off, enforced by the API and every invoice action, including resumed invoices. Email, print and download remain available; existing links keep their expiry and confirmation controls |
| Some stock connection edits lacked navigation protection | Unsaved stock connection edits participate in the existing Settings leave guard |
| Same-page private editors could retain an old shared revision | Coordinated refresh prevents avoidable conflicts between sharing/templates and email/stock connections while preserving dirty fields and secrets |

## Practical simplification

- Less-used booking timing/capacity options and WhatsApp template editing are expandable.
- Removed repeated booking errors and the contradictory shared-save footer.
- Inactive online-card reservation templates are excluded from everyday email choices without deleting their saved wording.
- Custom invoice colour is hidden when website colour is used; logo size is hidden when the logo is off. Retained values remain available when re-enabled.
- Phone document/settings choices wrap into visible buttons instead of hiding off-screen.
- Connections remain under Advanced; protected credentials, permissions and unreleased features were not relaxed.

## Areas checked and customer wiring

| Settings area | Checks and downstream use |
| --- | --- |
| Dealership details | Contact/address/showroom hours and legal/social details; contact page, footer, visiting details and review-request link |
| Website / Brand | Name, logos, favicon and colours; public header/footer and tenant branding |
| Website / Homepage | Copy, sections and featured stock; customer homepage |
| Website / Photos & visits | Hero/team images and arrival instructions; homepage, contact and booking details |
| Website / Services | Warranty, delivery and part-exchange visibility; public service actions |
| Website / Selling points | Structured selling points and existing short points; homepage |
| Website / Page wording | Existing page-copy fields, empty-value defaults and draft retention |
| Website / Vehicle sheets | Website-colour inheritance and print options; one-page vehicle sheet |
| Website / Review & publish / history | Change summary, validation, retained draft, revision conflicts, restore then save |
| Bookings | Toggle, independent appointment hours, explicit copy preview, limits, blocked dates and instructions; availability and customer booking/reschedule policies read saved values per request |
| Email templates | Message editing, branding, sample preview and separate saves; existing tenant wording and delivery behaviour retained |
| Invoices & terms | Design, payment details, terms and preview; new documents use saved options, issued documents retain frozen design and amounts |
| WhatsApp & QR | Main sharing preference, invoice-specific restriction, templates and manual confirmation; existing links/confirmation/revocation preserved |
| Price updates | Threshold/contact interval persistence; Home suggestions only, no advertised/agreed price or payment rewrites |
| Watch this car | Enable/disable/save; public availability, subscribe/verify and manual staff update review recheck policy/email readiness; unsubscribe remains usable |
| Team & access | Permission gates, invitations/roles and dirty-role protection in regression coverage; no live access grants or role changes |
| Advanced / Connections | Email readiness and protected setup; platform-only stock connection remains separate from Grok schedules |
| Advanced / Search visibility | Published-detail checks, internal links and provider guidance; indexing/account ownership is not claimed as verified |

## Verification

- Final full frontend regression run: **205 files, 2,234 tests passed**.
- Full API regression suite: **54 groups, 786 tests passed, zero failures/skips**, including real PostgreSQL Settings/stock/booking/tenant tests and isolated fixture tests.
- Disposable PostgreSQL migration verification: all **57 migrations**, **80 tables**, exact columns and required indexes, legacy data preservation, booking constraints and idempotent replay passed. No new migration is needed for this change. The temporary database/runtime was removed.
- Frontend and API typechecks and production builds passed under Node 24.19.0. The frontend retains the existing large-bundle warning; the builds succeed.
- The browser also completed website-name publish→public-homepage→restore, booking off→save→on→save, Watch off→save→on→save, and sharing/template saves in both orders against the local fixture. All were restored to the initial functional values. No email was sent. Invoice A4 and email previews opened at phone width without horizontal page overflow.
- Private save coordination is triggered only by a successful save, with no added polling. Dirty editors advance only across the exact proven revision transition; the masked-secret-rotation race is covered.
- Browser layout checks: 390×844, 834×1194, 1194×834 and 1440×1000 CSS-pixel frames rendering the real local React interface. Every top-level area and document/advanced subsection had matching page/client widths and no unexpected alert after enabling the explicit Watch fixture. Website subsections were also inspected independently. Evidence is in `output/settings-audit/`.
- Live booking proof: `output/settings-audit/live-booking-enabled.png` and `live-customer-available-times.png`.

### Test maintenance

The broad run exposed obsolete fixtures. Tests now assert the deliberately retired sales endpoints return 410 without changing saved customers/invoices/payments, and that unreleased online-card reservation endpoints remain blocked without creating holds/leads/stock writes. Active sale-workspace and reservation-policy coverage remains. Other fixtures were corrected for current tenant context, provider injection, valid SEO routes and timestamp ties. The migration test no longer hardcodes the old 0016 journal. These changes do not re-enable retired workflows or weaken production permissions/business rules.

## Limits and release status

Responsive browser frames verify CSS/layout and visible controls; physical iPhone/iPad Safari testing remains outstanding. Real provider delivery, personal WhatsApp sending, camera capture, cloud credentials and external marketplace scheduling were not exercised or changed by this audit. The actual live Shore Drive booking availability was checked without sending a customer message.

Only the live Shore Drive timetable/booking enablement has been published. The code changes, including invoice QR being off by default, await an explicit release. Existing issued invoices, amounts, payments and stock records were not rewritten. No automatic customer messaging was introduced.
