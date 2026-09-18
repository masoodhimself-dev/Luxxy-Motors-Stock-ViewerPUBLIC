# Luxxy Motors UI/UX redesign

Latest review: [final visual QA findings](#final-visual-qa--16-september-2026) and [40 fresh desktop/mobile screenshots](ui-qa-screenshots.md).

Branch: `codex/luxxy-premium-ui-redesign`. Starting point: `d548c0b` (the existing local preview and mobile fixes, preserved separately).

## Frontend audit

Reviewed the route tree, customer pages, stock/saved contexts, navigation, shared controls, staff components, generated-client usage and existing tests before redesigning. The customer routes are home/stock, vehicle detail, saved, comparison, Find My Car, enquiry (five enquiry types), viewing management, customer details, signing, staff access and not-found. Staff routes contain Today, leads/list/detail/manual capture/activity/outcomes, deals/create/checklist/signing/final checks, channels and showroom settings. Stock imports are an API capability; there is no separate stock-import UI to replace.

Main findings:

- Three competing visual systems: hard-offset borders/shadows, newer rounded cards and global CSS overrides. Tiny, widely tracked bold text and oversized headings made both marketing and operational screens harder to scan.
- Homepage lacked a photographic first impression. Vehicle cards spent too much space on four competing contact buttons and spec pills. Configured trust points were not shown.
- Vehicle detail lacked save/share/enquiry actions and did not expose optional description/features. Its gallery cropped wide photos, hid arrows on touch screens and had no modal focus trap.
- Forms and secure-link pages were visually heavy; the selected vehicle occupied too much space before the booking form on mobile.
- Staff work queues were nested cards inside cards. Large greetings, pill navigation, ornate forms and tiny status labels competed with actual follow-up work. Channel tables needed a contained mobile scrolling region.
- Native-select styling removed the dropdown affordance. Several custom dialogs lacked focus containment, and some custom focus styles suppressed visible keyboard focus.

## Design system and stages

1. Preserve baseline; add a clearly marked, read-only local review harness for actual customer and staff components. Archived vehicle photography comes from the repository's existing stock snapshot. It is not current stock.
2. Establish warm white, charcoal and restrained bronze defaults; DM Sans/Manrope typography; 4–6px corners; fine borders; 44px touch controls; semantic focus/feedback states. Dealer-configured branding remains supported.
3. Redesign navigation, homepage/search, stock cards and detail/gallery; retain search/filter/sort/save/compare and contact handlers.
4. Apply the system to saved/comparison, matching, enquiries/booking and secure customer pages, then the staff desk and its workflows.
5. Verify responsive layouts and keyboard journeys in Chromium, run all existing tests and full workspace typecheck/build. Commit stages separately for review.

## Scope boundary

Production entry/authentication, API contracts/clients, backend routes, database/schema/migrations and sales rules remain unchanged. Preview fixtures are confined to the separate development Vite config, reject every write and never connect to a database. No deployment or merge to main.

## Implemented screens

- **Homepage and stock:** vehicle-led photographic opening, configured dealership trust points, simpler search/filter/sort controls, grid/list views, consistent prices and quieter vehicle cards. Featured-vehicle selection still comes from showroom settings; the first available configured vehicle supplies the lead photograph.
- **Vehicle detail:** large uncropped gallery with swipe/arrow/fullscreen controls, price and key facts, specification ledger, optional supplied descriptions/features, insurance-history disclosure, save/compare/share, enquiry, viewing, phone and WhatsApp actions. No invented vehicle features or service-history claims.
- **Saved and comparison:** the same cards and controls, responsive side-by-side specifications, removal controls, sticky comparison labels and accessible contact icons. The comparison tray stays on browsing pages and no longer covers staff or booking forms.
- **Find My Car, five enquiry types and viewing booking:** quieter hierarchy and controls; mobile booking puts date/time selection before the contact-details step, retaining availability checks, validation and the existing payload.
- **Viewing management, customer details, signing and error/loading/success states:** consistent surfaces, fields, buttons and visible focus. Staff entrance and Clerk appearance are visually aligned; production authentication is unchanged.
- **Staff:** Today, leads, lead detail/contact activity/outcomes, manual lead capture, sales list/create/readiness/final checks, channel table and showroom settings. Work lists are compact rows; existing priorities and workflow restrictions remain in place. No new KPI widgets.

## Shared system and accessibility

DM Sans is the body face; Manrope is used for headings. Warm white, charcoal and bronze defaults replace the competing visual treatments, while the existing dealer-colour configuration still applies. Fine borders, small corners and flat surfaces keep attention on photographs and information.

Shared Button, Input, Textarea, NativeSelect, Card, Badge, Alert, Dialog, Select, Popover and DropdownMenu styles were improved. PageHeading is shared by saved/comparison. CarCard, Gallery, saved/compare controls and portal Panel/FieldLabel/SelectField/Chip/EmptyState provide reusable compositions. Existing loading and error states use the same palette and surfaces.

- Main controls use at least 44px touch targets. Text-entry fields use 16px text, including the staff settings form.
- Layouts were checked at 320, 390, 768 and 1440px, with existing tests also covering 402 and 1024px. Layout transitions use 640/768/1024/1280px and a compact-card adjustment at 480px.
- Mobile stock keeps search near the start; advanced filters expand in place. Galleries retain the whole photograph and expose touch arrows. Detail actions stay within reach at the bottom with safe-area spacing.
- Keyboard focus remains visible. Gallery, lead-capture and sales dialogs contain focus and restore it on closing. Escape, gallery arrow keys, image announcements, labels and skip navigation are covered.
- Reduced-motion preferences suppress decorative transitions and photo hover cycling. Statuses retain text/icons in addition to colour. Channel-table horizontal scrolling is contained in a labelled, keyboard-focusable region.
- Browser tests cover loading, expired secure links and success states using synthetic responses. These checks are not a formal WCAG certification or a substitute for physical-device testing.

## Initial redesign verification (16 September 2026)

| Check | Result |
| --- | --- |
| Frontend Vitest suite | **118 passed**, 15 files |
| Playwright Chromium suite | **40 passed**, including responsive routes, populated comparisons, form payloads, secure-link states and keyboard dialogs |
| API integration/safety suite | **35 passed**: 2 safety, 12 stock, 10 sales, 9 leads, 2 portal |
| Migration integration verification | **1 passed**, on a fresh disposable local database |
| Full workspace typecheck | **Passed**: shared libraries, frontend, API, mockup sandbox and scripts |
| Full workspace production builds | **Passed**: frontend, API and mockup sandbox |
| Git whitespace validation | **Passed** |

Commands used:

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @workspace/luxxy-motors test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' LUXXY_LOCAL_PREVIEW=1 pnpm --filter @workspace/luxxy-motors test:mobile-layout
LUXXY_TEST_DATABASE_URL=postgresql://luxxy_test@127.0.0.1:55439/luxxy_test_milestone1 pnpm --filter @workspace/api-server test
LUXXY_TEST_DATABASE_URL=postgresql://luxxy_test@127.0.0.1:55439/luxxy_test_ui_migrations pnpm --filter @workspace/api-server test:migrations
PORT=4175 BASE_PATH=/ NODE_ENV=production pnpm build
```

The two databases are disposable local PostgreSQL 16 databases, not Replit. PostgreSQL was stopped after testing. The normal API test guard requires an explicitly named loopback test database. No production credentials or database were used; no migration was deployed.

Build warnings remain: Vite reports an existing tooltip sourcemap diagnostic and a frontend JavaScript chunk of approximately 802KB (225KB gzip), above its 500KB advisory threshold. Neither fails the build. Splitting public and staff bundles is a separate performance improvement.

## Initial review and remaining work

Run `pnpm dev:preview`, then open `http://127.0.0.1:4175`. Useful routes: `/`, `/vehicle/preview-1`, `/enquire?type=viewing&vehicleId=preview-1`, `/portal`, `/portal/leads/sample-lead-1`, `/viewing/sample`, `/customer-details/sample` and `/sign/sample`. Select two cars to populate `/compare`, or save them to populate `/saved`.

[Desktop and mobile screenshot gallery](ui-redesign-screenshots.md) — eight important journeys at 1440px and 390px. Archived cars/photographs and synthetic staff/customer records are explicitly labelled. The preview rejects API writes; browser tests intercept submissions locally to verify their payloads. Production components continue using the existing clients.

Remaining visual validation is against the dealership's actual configured branding, current inventory/description quality and a real Clerk development account. Physical iPhone/Safari and Android device checks are still recommended; this run used Chromium at mobile sizes. The default logo remains the existing typographic mark. No live testimonials, stock, prices or trust claims were fabricated for the redesign.

Next step: review the visual branch and tune approved branding/content, then perform device and authenticated staging acceptance. Hosting migration and Replit removal remain outside this branch. Nothing has been merged or deployed.

## Changed-file inventory

Paths are relative to the repository root. The 16 PNG screenshots are in `docs/screenshots/ui-redesign/`. This inventory excludes the separately preserved pre-redesign checkpoint.

- `README.md`
- `artifacts/luxxy-motors/preview/clerk.tsx`
- `artifacts/luxxy-motors/preview/portal.ts`
- `artifacts/luxxy-motors/preview/settings.ts`
- `artifacts/luxxy-motors/preview/stock.ts`
- `artifacts/luxxy-motors/src/components/car-card.tsx`
- `artifacts/luxxy-motors/src/components/compare-tray.test.tsx`
- `artifacts/luxxy-motors/src/components/compare-tray.tsx`
- `artifacts/luxxy-motors/src/components/dealer-settings-panel.tsx`
- `artifacts/luxxy-motors/src/components/enquiry-form.tsx`
- `artifacts/luxxy-motors/src/components/filters.tsx`
- `artifacts/luxxy-motors/src/components/gallery.tsx`
- `artifacts/luxxy-motors/src/components/layout.tsx`
- `artifacts/luxxy-motors/src/components/page-ui.tsx`
- `artifacts/luxxy-motors/src/components/portal/activity-composer.tsx`
- `artifacts/luxxy-motors/src/components/portal/channel-summary.tsx`
- `artifacts/luxxy-motors/src/components/portal/deals-panel.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-capture.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-card.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-detail.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-form-fields.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-list.tsx`
- `artifacts/luxxy-motors/src/components/portal/portal-ui.tsx`
- `artifacts/luxxy-motors/src/components/portal/work-queue.tsx`
- `artifacts/luxxy-motors/src/components/saved-car-controls.tsx`
- `artifacts/luxxy-motors/src/components/ui/alert.tsx`
- `artifacts/luxxy-motors/src/components/ui/badge.tsx`
- `artifacts/luxxy-motors/src/components/ui/button.test.tsx`
- `artifacts/luxxy-motors/src/components/ui/button.tsx`
- `artifacts/luxxy-motors/src/components/ui/card.tsx`
- `artifacts/luxxy-motors/src/components/ui/dialog.tsx`
- `artifacts/luxxy-motors/src/components/ui/dropdown-menu.tsx`
- `artifacts/luxxy-motors/src/components/ui/fields.test.tsx`
- `artifacts/luxxy-motors/src/components/ui/input.test.tsx`
- `artifacts/luxxy-motors/src/components/ui/input.tsx`
- `artifacts/luxxy-motors/src/components/ui/native-select.tsx`
- `artifacts/luxxy-motors/src/components/ui/popover.tsx`
- `artifacts/luxxy-motors/src/components/ui/select.tsx`
- `artifacts/luxxy-motors/src/components/ui/surfaces.test.tsx`
- `artifacts/luxxy-motors/src/components/ui/textarea.test.tsx`
- `artifacts/luxxy-motors/src/components/ui/textarea.tsx`
- `artifacts/luxxy-motors/src/config/dealer.ts`
- `artifacts/luxxy-motors/src/index.css`
- `artifacts/luxxy-motors/src/lib/clerk-appearance.ts`
- `artifacts/luxxy-motors/src/pages/car-detail.test.tsx`
- `artifacts/luxxy-motors/src/pages/car-detail.tsx`
- `artifacts/luxxy-motors/src/pages/compare.tsx`
- `artifacts/luxxy-motors/src/pages/customer-details.tsx`
- `artifacts/luxxy-motors/src/pages/enquire.tsx`
- `artifacts/luxxy-motors/src/pages/find-my-car.tsx`
- `artifacts/luxxy-motors/src/pages/home.test.tsx`
- `artifacts/luxxy-motors/src/pages/home.tsx`
- `artifacts/luxxy-motors/src/pages/not-found.tsx`
- `artifacts/luxxy-motors/src/pages/portal.tsx`
- `artifacts/luxxy-motors/src/pages/saved.tsx`
- `artifacts/luxxy-motors/src/pages/signing.tsx`
- `artifacts/luxxy-motors/src/pages/staff-access.tsx`
- `artifacts/luxxy-motors/src/pages/viewing.tsx`
- `artifacts/luxxy-motors/src/preview.tsx`
- `artifacts/luxxy-motors/src/test/showroom-style.test.tsx`
- `artifacts/luxxy-motors/src/test/showroom-style.ts`
- `artifacts/luxxy-motors/tests/redesign-journeys.spec.ts`
- `artifacts/luxxy-motors/tests/secure-link-showroom.spec.ts`
- `artifacts/luxxy-motors/vite.preview.config.ts`
- `docs/ui-redesign-screenshots.md`
- `docs/ui-redesign.md`


## Final visual QA — 16 September 2026

Reviewed the existing redesign in the local browser as a dealership showroom and working sales desk. The changes in this pass are confined to frontend presentation, client-side interaction fixes, tests and review evidence. No backend, database, API contract, authentication logic, sales rules, migration or deployment configuration was changed. No production service or database was used. The local preview remains read-only and uses archived stock with synthetic staff/customer records.

### Problems found and changes made

- **Stock sat too far below the desktop opening.** Reduced hero and section spacing, arranged desktop search/sort/actions in one row, and enlarged stock photography with three columns. Latest arrivals now shows three vehicles before View all, avoiding an isolated fourth card. Search and View all still expose the complete matching stock.
- **Vehicle information had distracting inconsistencies.** Display titles no longer repeat a leading make such as “MG MG”; original stock records are untouched. Zero mileage displays correctly. Two-column key facts avoid stranded separator dots. London telephone numbers use readable spacing. Existing Category S/N history is linked beside the vehicle facts.
- **Comparison prices were too far down the page.** Price now appears immediately below each vehicle title, with quieter comparison labels and less vertical padding. The mobile comparison tray starts collapsed with its Compare action visible, retaining expand, remove and dismiss controls.
- **Saved/compare headers and empty states were overbuilt.** Removed duplicated wrappers/dividers, added shared PageEmptyState, simplified copy, and kept unavailable saved cars distinct from a genuinely empty shortlist. Failed stock requests now show a retry state and preserve saved IDs instead of pretending the shortlist is empty.
- **Viewing Continue triggered premature form validation.** React reused the button that becomes Submit on the next step. Separate button keys and prevention of the original click's default action stop that accidental submission. Focus moves to the name field; availability, validation and submission payloads are unchanged.
- **Changing enquiry service left a stale heading.** The parent heading/intro now follows the form selection without resetting entered details. The part-exchange stock selector has an accessible label. Removed a decorative sparkle badge, premature “reserved” wording and unsupported vehicle-preparation promises.
- **The finder presented itself as a scoring dashboard.** Removed internal point totals, oversized result banners and repeated badges. Cars, preference explanations and differences now lead. Matching/scoring, all five questions and three result views remain intact.
- **Staff navigation and page introductions consumed too much mobile space.** Staff pages use a compact brand header with View showroom, an inline New lead action and five tabs. Leads filters fit two columns. Work queues, activity capture and new-lead/deal introductions use shorter operational copy. Duplicate enquiry text is shown once. Settings actions occupy one compact sticky row.
- **Keyboard users could tab through 70 gallery thumbnails.** The strip now has one tab stop, with Left/Right/Home/End moving the selected photograph and focus. Fullscreen focus containment and Escape continue to work. Mobile menu rows/footer links and the unavailable-stock removal action retain comfortable touch targets; WhatsApp uses a darker contrasting colour.
- **Secure-link pages repeated information and used excessive all-caps copy.** Removed the duplicate customer-details introduction, formatted signing mileage, and made viewing reschedule dates a four-column mobile grid. Signing controls, consent requirements and sale restrictions are unchanged.

### Interactive review coverage

Desktop and mobile versions were compared, with final evidence at **1440 × 1000** and **390 × 844**. Automated layout coverage additionally includes 320, 375, 402, 768 and 1024px.

| Area | Pages and interactions reviewed |
| --- | --- |
| Homepage / stock | Full page, advanced filters, make/search, sort, no results/reset, grid/list controls, View all, header/mobile menu and footer |
| Vehicle detail | Mercedes and MG examples; photographs/thumbnails, fullscreen, keyboard arrows/Escape, save/compare, history disclosure, related stock, enquiry/viewing links and sticky mobile actions |
| Saved / compare | Populated, one/two/zero selections, remove/clear, empty and unavailable stock; stock failure and persistence covered by browser interception |
| Enquiries | General, viewing, part exchange, warranty and delivery; service changes, date/time selection, Continue, focus and validation. No real enquiry sent |
| Find My Car | Five-question journey, result explanations; automated interaction also checks compact/shortlist views and changing answers |
| Customer links | Customer-details form/native validation; viewing reschedule/time selection/cancellation confirmation and backing out; signing fields, consent/enabled state and Edit details link. No agreement signed |
| Staff | Today queues; leads list/filter controls; lead detail, next action and outcome editor; New lead dialog; deals list/detail/new-sale dialog/checklist; channels table; settings sections/contact/hours and action bar. No lead/sale mutation or Publish action performed |
| State coverage | Loading, expired links, successful fixture responses, stock errors and empty states in the browser suite; responsive not-found coverage retained |

The real Clerk sign-in screen, generated document pack and external communication destinations require a separate authenticated staging review. Stock imports have no separate frontend page. The existing API integration and migration results above belong to the initial redesign verification, and were **not rerun in this frontend-only QA pass**.

### Final verification

| Check | Final result |
| --- | --- |
| Complete frontend Vitest suite | **119 passed**, 15 files |
| Full Playwright Chromium suite | **49 passed**: 47 behaviour/layout checks and two opt-in screenshot journeys |
| Final screenshot recapture | **2 passed** after adding explicit readiness checks; 40 PNGs across 16 page pairs plus eight viewport images |
| Workspace typechecking | **Passed**, including shared libraries, frontend, backend, mockup sandbox and scripts |
| Workspace production builds | **Passed**, frontend, backend and mockup sandbox |
| Whitespace/scope review | **Passed**; this QA diff is confined to `artifacts/luxxy-motors/` and `docs/` |

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @workspace/luxxy-motors test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' LUXXY_LOCAL_PREVIEW=1 LUXXY_QA_SCREENSHOTS=1 pnpm --filter @workspace/luxxy-motors test:mobile-layout
PORT=4175 BASE_PATH=/ NODE_ENV=production pnpm run build
```

No final test or build failures remain. Restarting the local preview also logged a pre-transform warning for the production entry’s `@clerk/react/internal` import under the existing preview alias; the separate preview entry rendered successfully and was verified in a fresh browser tab. This existing preview-configuration warning has not been suppressed or changed in this UI pass.

Vite still emits its tooltip sourcemap diagnostic and the large-chunk advisory: approximately **796KB JavaScript / 224KB gzip**. These are not build failures; splitting public and staff code remains a separate performance task.

### Visual judgement and remaining work

This pass improves vehicle prominence, price visibility, restrained typography and staff task density. It is ready for review on the design branch. Passing tests does not establish launch readiness:

- The archived photographs vary in lighting, background and framing. A consistent set of real exterior/interior photos would improve the commercial impression more than additional decoration.
- Some records lack descriptions and feature lists. Accurate supplied content is needed for a convincing vehicle detail page; it has not been invented. Review current stock and the dealership's configured service/branding copy before publication.
- Confirm the real address, opening hours, company details and contact destinations in an authorised staging environment. The read-only preview is not evidence of the production configuration.
- The development sales warning remains prominent, especially on mobile. It reflects existing workflow restrictions and has deliberately not been hidden or weakened. Actual document content and authenticated sales acceptance remain outside this UI pass.
- Physical iPhone/Safari and Android testing, including software keyboards, native share and telephone/WhatsApp hand-offs, remains outstanding. Mobile-width Chromium is not a substitute.

No merge, push or deployment was performed. Recommended next step: visual approval and real content/branding review, followed by authenticated staging and physical-device acceptance. Replit removal remains a separate milestone.

### Files changed in this QA pass

The following source/test inventory supplements the initial redesign inventory above. Review documentation is in `docs/ui-redesign.md`, `docs/ui-qa-screenshots.md` and `docs/ui-redesign-screenshots.md`; 40 evidence images are in `docs/screenshots/ui-qa/`.

- `artifacts/luxxy-motors/src/components/car-card.tsx`
- `artifacts/luxxy-motors/src/components/compare-tray.tsx`
- `artifacts/luxxy-motors/src/components/dealer-settings-panel.tsx`
- `artifacts/luxxy-motors/src/components/enquiry-form.tsx`
- `artifacts/luxxy-motors/src/components/filters.tsx`
- `artifacts/luxxy-motors/src/components/gallery.tsx`
- `artifacts/luxxy-motors/src/components/layout.tsx`
- `artifacts/luxxy-motors/src/components/page-ui.tsx`
- `artifacts/luxxy-motors/src/components/portal/activity-composer.tsx`
- `artifacts/luxxy-motors/src/components/portal/deals-panel.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-capture.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-detail.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-list.tsx`
- `artifacts/luxxy-motors/src/components/portal/portal-ui.tsx`
- `artifacts/luxxy-motors/src/components/portal/work-queue.tsx`
- `artifacts/luxxy-motors/src/components/saved-car-controls.tsx`
- `artifacts/luxxy-motors/src/index.css`
- `artifacts/luxxy-motors/src/lib/utils.test.tsx`
- `artifacts/luxxy-motors/src/lib/utils.ts`
- `artifacts/luxxy-motors/src/pages/car-detail.tsx`
- `artifacts/luxxy-motors/src/pages/compare.tsx`
- `artifacts/luxxy-motors/src/pages/customer-details.tsx`
- `artifacts/luxxy-motors/src/pages/enquire.tsx`
- `artifacts/luxxy-motors/src/pages/find-my-car.test.tsx`
- `artifacts/luxxy-motors/src/pages/find-my-car.tsx`
- `artifacts/luxxy-motors/src/pages/home.test.tsx`
- `artifacts/luxxy-motors/src/pages/home.tsx`
- `artifacts/luxxy-motors/src/pages/portal.tsx`
- `artifacts/luxxy-motors/src/pages/saved.tsx`
- `artifacts/luxxy-motors/src/pages/signing.tsx`
- `artifacts/luxxy-motors/src/pages/viewing.tsx`
- `artifacts/luxxy-motors/src/preview.tsx`
- `artifacts/luxxy-motors/tests/redesign-journeys.spec.ts`
- `artifacts/luxxy-motors/tests/secure-link-showroom.spec.ts`
- `artifacts/luxxy-motors/tests/visual-qa-capture.spec.ts`

## Template refinement and additional visual QA — 17–18 September 2026

The subsequent request to implement all six product recommendations and visual refinements is documented in [the template refinement report](template-refinement.md), with [42 fresh screenshots](screenshots/template-refinement/). This adds the shared drawn wordmark, mobile homepage photography, consistent stock-card rhythm, buyer information, caption-grouped gallery, return-to-stock state, visit/team content, quieter staff presentation and focused worklists. Staff and secondary customer routes now load separately.

The user clarified that the site is a reusable template and explicitly authorised extending settings storage. The new optional `presentation` content uses the existing dealer-settings JSONB column and API, including compatibility for older settings clients. No migration was required or run. No other backend functionality, authentication or sales rule was changed. No production data was read or written, and nothing was merged, pushed or deployed.

Final validation for this refinement: 123 frontend tests; 55 browser checks; four settings compatibility tests; two database-safety tests; complete workspace typechecking and production builds passed. Full database integration tests were not rerun because there was no prepared disposable local database and migrations were explicitly excluded. See the report for exact commands, scope and remaining verification.

The main website JavaScript chunk is now approximately 528KB / 159KB gzip, down from 796KB / 224KB. A 390px local first load made two image requests instead of eighteen. Vite’s 500KB advisory and existing tooltip sourcemap warning remain. Real device/performance checks and each business’s genuine content and photography are still needed before production acceptance.

## Homepage composition refinement — 18 September 2026

Implemented the six approved homepage changes: complete-frame hero photography with its caption below, earlier stock, compact search/sort/filter controls, tighter vehicle-card spacing, a configurable photographic dealership introduction and more grounded template copy. Dealer assurances now sit alongside the desktop introduction. At 390px the first stock card begins at about 794px, versus the previous recorded 890px; at 1280px desktop it begins at 676px. The narrowest phone layout keeps its results button full width.

See [the homepage refinement report](homepage-polish.md) for the full change inventory, verification and remaining limitations, and [ten fresh screenshots](screenshots/homepage-polish/) for desktop/mobile evidence. The preview photography remains illustrative archived stock; each business can supply genuine photographs using the existing onboarding fields. Existing stored copy is respected and was not overwritten.

Final checks: 123 frontend tests, 55 browser checks, four settings tests, two database-safety tests, workspace typechecking and all workspace builds passed. Existing sourcemap/chunk-size diagnostics remain. Database integration suites and physical-device checks were not run. No backend code, database, API contract, authentication, sales rule or production deployment was changed; no merge, push or deployment was performed.

### Supplied Mercedes hero — 18 September 2026

Replaced the preview's warehouse hero with the user's supplied Luxxy Mercedes brand artwork, optimised to a bundled 1536×1024 JPEG. It links to the stock collection with no individual vehicle price. Custom images and featured selections retain precedence, and other dealership identities retain their own stock imagery. See [the updated report](homepage-polish.md) and [desktop/mobile captures](screenshots/brand-hero/). All 127 frontend tests, 55 browser checks, workspace typechecking and builds passed. This update changes no backend code or production data.

### Booking-page refinements — 18 September 2026

Implemented the four approved booking refinements: quieter price below the photograph, compact specifications with fine dividers, “Your selected car” / “Change car” labels, and tighter mobile spacing. Change car now opens stock using existing focus-aware navigation on both screen sizes; mobile vehicle names wrap. Desktop no longer duplicates the selected car inside the form. Booking rules and payloads are unchanged.

See [the booking report](booking-polish.md) and [eight desktop/mobile screenshots](screenshots/booking-polish/). All 127 frontend tests, 55 browser checks, workspace typechecking and builds passed; two capture checks and the workspace build were rerun after the final visual adjustment. Existing Vite diagnostics remain. Additional design suggestions are documented for review and have not been implemented. No backend or production changes, migration, merge, push or deployment occurred.
