# Customer website and staff portal audit — 23 October 2026

## Scope and outcome

Focus: ease of use, factual accuracy and professional presentation. Work is local on `codex/customer-portal-audit`; nothing deployed, merged or sent to a customer. Existing Google-review Settings work is retained from the parent branch.

The audit used the rendered fixture-backed React application, browser screenshots and interactions, a read-only check of Shore Drive's live homepage, source inspection and automated regressions. Screen sizes: 390px phone, 834px tablet and 1440px desktop. Additional existing booking checks use 375px and 820px. These are browser viewport checks, not physical iPhone/iPad certification.

## Fixes made

| Finding | Fix | Verification |
| --- | --- | --- |
| On phones, Today / Inbox / Test drives still used widths designed for four destinations. Test drives was partly hidden off to the side. | Three equal navigation columns; all labels remain visible, retain their colour accents and have at least 44px targets. | All three buttons checked within the viewport at all audit widths; phone screenshot reviewed. |
| Website Settings allowed horizontal scrolling on tablet and desktop. Visually hidden file controls inherited full-width text-field styling and extended outside their columns. | Exclude file and radio controls from the two broad text-field style rules. The accessible upload buttons and real file inputs remain functional. | Settings sweep passes at 390/834/1440px; no document-level overflow. |
| Sales used promotional copy instead of a straightforward page title. | “Sales & invoices” replaces “Simple paperwork. Clear records.” | Existing Sales tests and rendered page checks. |
| Test-drive booking contained a talking-car joke where practical instructions would help more. | “Before your test drive” plus a short driving-licence/contact reminder. | Booking unit suite and responsive booking journey. Timing, availability and booking rules unchanged. |

No backend, database, permission, payment, stock-import, email-delivery or booking-rule changes were made.

## Page coverage

Every row below was rendered at all three audit sizes. The sweep captures full-page screenshots, checks for page-level horizontal overflow and uncaught JavaScript exceptions, and blocks API writes. Rendering a page is not proof of every possible interaction; the separate journey checks below provide additional coverage.

| Area | Pages/views inspected | Findings and disposition |
| --- | --- | --- |
| Customer discovery | Home, Browse Stock, available vehicle detail | Core hierarchy remains clear. Phone name/price are visible before the gallery. Do not replace the established colours, fonts or solid icons. Stock source data still needs editorial checks; see accuracy findings. |
| Shortlisting | Saved cars, Compare empty states | Recovery actions lead back to stock. Populated comparison combinations were covered by existing component tests, not every combination in this browser pass. |
| Contact | Contact page, general enquiry, delivery enquiry | Reply-method controls and general-enquiry fallback remain available. Missing dealer contact facts must be supplied rather than guessed. |
| Buying journeys | Selected-car test-drive booking, part exchange | Selected vehicle remains identifiable during booking. Useful preparation text replaces the joke. Existing times and validation preserved. |
| Information | Warranty page | Disabled/unconfigured warranty uses a contact fallback rather than invented cover. |
| Recovery | Missing page; expired purchase/booking links and payment-return states in dedicated tests | Clear recovery links; temporary errors can be retried; internal backend debug text is not exposed. |
| Phone/QR pages | Phone sharing, staff upload, enquiry-photo upload, dealership join without a valid token | Invalid-link guidance stays readable. Fresh, valid grants and physical-camera permissions were not exercised against live customers. |
| Staff daily work | Home, Inbox conversations, email records/drafts | Phone section navigation fixed. Existing Inbox test verifies pending reply attention, quoted-message collapse, actions and returning to the list. Home priorities deserve a further focused pass; see recommendations. |
| Test drives | Booking list and calendar | Layout and empty state inspected. Existing appointment times/rules preserved. |
| Stock management | Cars list and car details | Search/filter and status distinctions remain visible. Preview correctly explains that uploads and changes are disabled. |
| Sales | Sales list and five-step new invoice form | All five steps traversed with fictional buyer data at 390/834/1440px, without saving payments or issuing an invoice. Buyer step retains selected car and Change car. Final creation requires staff confirmation. Reminder list remains non-fillable. |
| Reservations | Online reservations list | Customer, vehicle, amount received and actions remain distinct. No cancellation, payment or new reservation performed. |
| History | Vehicle & customer history | Rendered and checked at all sizes; fixture records can be searched. No real-customer merge or cross-dealer history mutation attempted. |
| Settings | Default / dealership details, website, bookings, emails, invoices & terms, WhatsApp & QR, team, integrations, search visibility and publication history | Page width fixed. Draft/publish and individual save distinctions remain. Some email preview requests are POSTs and were deliberately blocked in the read-only sweep; provider rendering is not certified by this pass. |

## Accuracy findings requiring confirmation or further work

1. **Shore Drive live contact setup is incomplete.** The live homepage inspected on 23 October showed no configured phone, showroom address or opening hours. It correctly asked customers to confirm details rather than claiming opening times. Add the dealer's confirmed details in Settings before relying on the site for showroom visits. This audit did not invent or publish them.
2. **Source prose can disagree with structured vehicle facts.** The local Nissan Qashqai example described “6 owners” while the structured section displayed 7 previous keepers. Its prose also described no prior service history while the structured field said partial history. These are content conflicts in the preview dataset, not proof that the current live car is wrong. Confirm the real documents and distinguish current/previous keeper counts before editing either source. Retain important disclosures.
3. **Preview data is not live evidence.** Sample address/hours/reviews, old appointment dates and inconsistent reservation snapshots were observed locally. Do not publish sample material or describe sample review verification as an independently checked Google review. Live review authenticity was not established in this audit.
4. **Home and Inbox describe different work.** The local Home counted three “Awaiting a reply” tasks; Inbox counted one “Needs reply”, because its presentation prioritised missed visits separately. This is reproducible in the preview, but is not evidence of lost live messages. Reconcile the task definitions and labels in a dedicated change before treating the two figures as interchangeable. Do not change attendance or close enquiries automatically to make counts match.

## Recommended next changes, in priority order

| Priority | Recommendation | Benefit |
| --- | --- | --- |
| High | Complete confirmed live contact details and review source-data conflicts. | Prevents wasted journeys and contradictory sales information. |
| High | Give Home and Inbox one shared presentation of reply, missed-visit and follow-up tasks. | Staff see the same next action wherever they start. |
| Medium | Keep the phone Inbox's less-used filters behind its existing Filters control; consider a compact queue chooser after staff testing. | More of the first customer appears without scrolling. Avoid hiding required actions or changing queue rules. |
| Medium | Continue showing one primary action for the selected customer, with history and occasional tools secondary. | Reduces competing buttons while preserving access to evidence. |
| Medium | Refresh the legacy browser suites before using a blanket “all browser tests pass” release gate. | Avoids false failures and untested journeys after interface changes. |
| Low | Monitor the large generated PDF bundle and keep document-generation code off ordinary browsing paths where possible. | Potentially improves load performance; actual initial-load impact was not measured. |

These are proposals, not silent changes to business logic.

## Tests and evidence

- **180 frontend unit/component test files: 1,864 tests passed** on the final full run with two workers. Includes Quick Enquiry, email composer/history, WhatsApp templates/sharing, customer matching, sales, invoices, declarations, video controls, settings and role-gated UI.
- The first default-concurrency unit run had one 5-second email-template test timeout; its focused rerun and the complete final run passed.
- **21 browser checks passed** using `playwright.usability-audit.config.ts`: six customer/staff page sweeps, three Inbox journeys, three review reminder journeys, three booking-responsive checks and six customer error/recovery checks.
- **Three additional five-step sales browser checks passed**, with no saved payment or invoice creation.
- The new page sweep covers **37 routes/views × 3 sizes = 111 rendered page checks**, with screenshots, overflow assertions and uncaught-JavaScript-error assertions. This count is separate from interaction assertions.
- Workspace typechecking and production build passed. Build still reports large chunks, including the PDF generator; no bundle-size optimisation was attempted.
- `git diff --check` passed.
- Screenshots: `/tmp/luxxy-full-usability-audit/`. Phone Inbox proof: `/tmp/luxxy-audit-inbox-proof.png`.

### Tests that must not be represented as passing

An initial exploratory run of older `customer-practical-audit.spec.ts` and `sales-workspace.spec.ts` produced 17 failures. Examined failures expected now-hidden enquiry references, old disclosure selectors, the previous sales structure / New sale button, or a reserved first fixture vehicle. These legacy suites were not rewritten or counted as passed. A separate attempt at the older `enquiries-desk.spec.ts` failed at its superseded setup and was stopped. Current Inbox and five-step sales behavior was checked using the dedicated tests above.

One intermediate browser run lost its shared preview server after another test process stopped. It was discarded, then rerun successfully on its own dedicated port. Connection-refused results were not treated as product defects.

## Limits

No live customer messages, invoices, payments, bookings, stock changes, settings publications, credential changes or new access grants were made. Live SMTP delivery, real WhatsApp sending, native iOS/Android camera behavior, device push delivery, physical A4 printing, valid private-document grants, full cross-role/cross-tenant API security and production load were not retested end-to-end here. The platform dashboard was not part of this customer/staff rendered-page pass.

## Approved release — live verification

At the user's request, release `4993d33dcbed95ef65daef8f8a4d3b1e42b419d0` was pushed to the existing `codex/multi-tenant-foundation` release branch and deployed to `luxxy-shared-staging`.

- Render deploy `dep-dbdo7nt9fdbs73bqgkn0` reached **live** at 16:00:25 UTC, 23 October 2026 (17:00 UK).
- Included the parent change storing one dealership Google review URL in Settings. No new schema migration; existing pre-deploy command completed successfully.
- Shore Drive and Luxxy `/api/healthz` returned `ok`; `/api/readyz` returned `ready`.
- No error-level logs were returned for the post-live verification window.
- Live Shore Drive phone check: viewport and document width both 390px; Today, Inbox and Test drives all within the viewport.
- Live Shore Drive tablet Website Settings: viewport and document width both 834px.
- Google review link field confirmed under Dealership details → Contact & hours, without editing or publishing settings.
- Live Sales heading and Luxxy public booking guidance confirmed.
- No customer emails, WhatsApp messages, bookings, payments, invoices or reminders were created during release verification. Staff review and manual sending remain in place.
- Browser viewport reset; user left on Shore Drive Inbox. Screenshot `/private/tmp/shore-audit-release-phone.jpg`.
