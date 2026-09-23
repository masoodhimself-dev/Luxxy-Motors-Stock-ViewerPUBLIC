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

### Dealership introduction refinement — 18 September 2026

Reworked “Why Luxxy Motors” into a photographic introduction headed “Come and see for yourself.” Three editable template points explain viewings, vehicle details and purchase arrangements in a simple divided list. The section reuses the homepage Mercedes photograph, preserving its full frame. A separately configured showroom photograph still takes precedence, and existing business copy remains intact. Mobile puts the introduction above the photo and practical points; the viewing link retains its existing route.

See [the updated homepage report](homepage-polish.md#dealership-introduction--18-september-2026) and [six fresh screenshots](screenshots/introduction-polish/). All 128 frontend tests, 55 browser checks and full workspace typechecking/builds passed, with two screenshot/CTA checks repeated after improving the capture canvas. Existing build advisories remain. No backend, stored settings, production data, merge, push or deployment changes were made.

### Vehicle details PDF — 18 September 2026

Added View vehicle PDF and Download actions to each vehicle detail page. The user explicitly authorised a small read-only backend endpoint so the document can embed stock photography despite the image host's browser CORS restrictions. The PDF includes public specifications, price, supplied description/features, insurance history, buyer information, dealership contact details and captioned photographs. A new lookup reuses the public stock visibility predicate and projection across both import sources; existing endpoints and business rules are unchanged. No database writes, schema changes or migrations are involved.

See [the vehicle PDF report](vehicle-pdf.md) for the endpoint contract, image-host configuration, resource limits, verification and remaining checks. [Fresh screenshots](screenshots/vehicle-pdf/) show the desktop/mobile link and generated document. The 13-page Jeep sample contains all 58 photographs. Missing details stay unconfirmed, and archived preview PDFs are labelled throughout.

Validation: 129 frontend tests; nine brochure tests; four settings tests; two database-safety tests; 56 browser checks (two optional whole-site capture checks skipped); and full workspace typechecking/builds passed. The three PDF browser checks were repeated after the final download refinement. Existing Vite diagnostics remain. Codex's embedded PDF viewer did not render the file, so a separate download action is available. Database integration tests and physical-device checks remain outstanding. No production access, merge, push or deployment occurred.

## Design check follow-up — 18 September 2026

Implemented all eight areas from the desktop/mobile design review on `codex/luxxy-premium-ui-redesign`. The Mercedes hero, homepage hierarchy, vehicle photography, warm palette and existing business flows remain intact. This follow-up changes frontend UI, preview fixtures and tests only.

1. **Document review:** signing now renders every supplied document title and complete plain-text body, preserves line breaks, identifies required documents and the pack revision, and offers a keyboard-accessible “Read document pack” link from Agreement. React escapes document text; it is not interpreted as HTML. Empty/missing content is explained. Acknowledgements, completion payloads, revision binding and development-only signing rules are unchanged. The read-only preview now includes a sample document so future visual reviews cover this state.
2. **Unpublished settings:** edits are kept in session storage for this browser tab, with a 24-hour expiry, a visible Unpublished changes notice, explicit discard confirmation and clearing after successful publication. Drafts survive navigation and reload; memory fallback and an unload warning cover unavailable browser storage. Invalid/expired stored drafts are rejected. A warning identifies published settings that have changed since a draft began. “Preview showroom” is now “View published showroom”: it displays published content and retains the draft for the staff member’s return. This is intentionally not a live unpublished-site preview or a shared/cross-device draft feature. Failed initial settings loads also preserve subsequent edits.
3. **Insurance history:** vehicle and filter copy describe recorded structural/non-structural damage without claiming that repairs were completed. The UI directs customers to available repair and inspection records. No vehicle history data or sales rule changed.
4. **Accessibility:** specification labels use the readable secondary-text token; the signing warning has full-strength text; form boundaries have stronger contrast without darkening decorative dividers. Booking Change/Back and signing Edit controls have at least 44px target heights. Rendered measurements on home, vehicle, booking, signing, lead and settings views found no low-contrast text candidates; sampled input boundaries measured 3.58:1. This is a targeted check, not a WCAG certification or a guarantee for arbitrary dealer-selected colours.
5. **Stock filtering:** empty inventory has its own message and a working enquiry route. No-match advice is reserved for actual filtered results. Selecting a contradictory budget clears the conflicting bound and announces why; old invalid browse sessions are normalised. Individual active filters remain removable when the advanced panel is collapsed.
6. **Staff forms:** the sale dialog has one heading and one development notice, a scrollable form body, clear divided sections and a stable action footer. Vehicle/customer fields use the available width. The lead contact form now gives stage/action two columns and due date/time its own row. Customer selection, QR generation, validation, amounts, fulfilment and sale mutations are unchanged.
7. **Onboarding:** colour pickers and editable hex codes sit above optional advanced HSL fields; the existing settings API continues receiving HSL. Invalid colour values cannot be published. “Profile completeness 100%” is replaced with a count of basic fields plus an explicit pre-publication checklist distinguishing missing, template and unverified/optional information. No new confirmation flags or backend settings were introduced.
8. **Visual finishing:** the visit/team section uses a compact layout when no team photo is supplied; comparison retains full sticky vehicle names and adds Show differences only; signing/customer-details/viewing links have a compact contact footer; hard-coded Find my car labels and repeated footer weekdays are consistent. The onboarding photography guide covers lighting, angle, framing, coverage and honest condition photos. Existing stock photographs were not altered or replaced, and no reviews, team photos or facts were invented.

### Validation and review

- Frontend: **134 tests passed** across 18 files. On Node 25, use the documented `NODE_OPTIONS=--no-experimental-webstorage` so jsdom supplies browser storage.
- Backend: **48 tests passed** (database safety, stock, sales, leads, portal, settings and PDF brochure). Tests used only `127.0.0.1:55439/luxxy_test_milestone1`, with the existing local-database/external-network guards. The local PostgreSQL runtime needed its resource paths restored in a temporary test-only copy. No production database, migration command or application backend code was touched.
- Browser (final verification 21 September): **63/65 checks passed after a targeted capture rerun; two existing PDF-photo checks still fail.** The complete run passed 62 checks and failed two real-host PDF image counts plus a desktop screenshot timeout. After replacing serial image decoding with concurrent bounded loading and unavailable-image attachments, both whole-site capture checks passed. All seven new design regression checks passed: supplied documents, safe text rendering, draft navigation/reload/discard/publication, colour serialization, conflicting budgets, empty inventory, comparison and the mobile sale footer. The PDF checks saw 8 of 58 photos; the unchanged image loader's 18-second deadline and slow remote downloads need separate investigation. No assertion was weakened and the backend is unchanged.
- Full workspace `typecheck` and `build` passed with `PORT=4175 BASE_PATH=/ pnpm build`, including frontend, API server, shared libraries and mockup workspace. Vite still reports the existing main-chunk size warning (approximately 531kB minified); no build failure remains.
- Manual local interaction and fresh evidence at **1440×1000 and 390×844**; existing browser coverage includes 320, 375, 402, 768 and 1024px. Checked settings draft navigation, sale dialog, signing/document jump, filters, booking controls and comparison. Fresh screenshots also cover saved cars, finder, staff queues/leads/deals/channels and customer links.

See [the follow-up report and 60-screenshot index](design-check-follow-up.md). Physical-device Safari/Android, screen-reader testing and hosted Clerk authentication still require a separate device/staging review. The archive/preview badges and sample dealership content are intentional. Stock photography consistency ultimately depends on photographs supplied by each dealership; the new guide supports that onboarding work. No merge, push or deployment was performed.

## Customer purchase review — 21 September 2026

Implemented the eight approved customer-view refinements on the existing redesign branch. The page now uses an ID-matched public stock photograph, a compact vehicle/price summary, three focus-aware navigation links and a linear reading order with documents before the agreement at every width. Vehicle/customer display supports the real signing snapshot keys (`vehicle.title`, `customer`) as well as older preview keys. Supplied disclosure notes stay visible.

Deposit is labelled **Agreed deposit**, and the remaining figure is **Balance after agreed deposit**: the existing signing response does not confirm payment receipt. It also does not expose fulfilment records, so the page explicitly asks the customer to confirm collection/delivery with the team. No dates, addresses or payment confirmation are invented.

The old Edit link incorrectly reused a signing token with the separate customer-intake API. It is replaced by a focus-aware **Request a correction** link and configured dealership phone/email actions. Copy distinguishes a secure contact-update link from dealer-managed changes to commercial terms. No tokens are put into contact messages and no message is sent automatically.

Documents retain their full plain-text content, readable measure and line breaks. **Download document text** saves a local copy; **Print / save PDF** uses the browser print dialog and hides site navigation and signing controls. This is not a new certified signed-PDF service. After a successful response, confirmation identifies the pack revision, focuses the receipt heading, removes the signing form, retains document access and explains the next steps. No acknowledgement, payload, validation, authentication or sales rule changed.

Validation: 134 frontend unit tests passed; 16 relevant browser regressions passed, including three new customer cases at 390/1440px and missing-content coverage. Workspace typechecking and builds passed, retaining the existing approximately 531kB chunk advisory. The three new browser cases were repeated after the final copy adjustment. Signing POSTs were intercepted in tests; no signature or real sale was recorded. No backend/database tests were rerun for this frontend-only change. Previously reported vehicle-brochure photo-loading failures are separate and were not changed or retested.

Fresh screenshots: [desktop review](screenshots/customer-purchase/review-1440.png), [mobile review](screenshots/customer-purchase/review-390.png), [desktop confirmation](screenshots/customer-purchase/confirmation-1440.png), [mobile confirmation](screenshots/customer-purchase/confirmation-390.png). Screenshots use synthetic customers and intercepted success responses, not a completed live sale. Physical-device/native-print checks remain outstanding. The preview remains read-only. No merge, deployment or production access.

## Homepage and vehicle browsing refinement — 23 September 2026

Completed the approved ten-point review while retaining the established homepage composition and Mercedes hero. Several recommendations were already implemented and were verified rather than rewritten:

1. Existing stock search, sorting, expanded results, scroll position and focus survive the return from vehicle details; the browser regression passes.
2. Cards retain consistent photography, price prominence and year/mileage/fuel/gearbox order. Specification values now have explicit accessible labels.
3. The existing onboarding fields accept real showroom/team photographs. No genuine business photographs were supplied, so the selected hero and clearly labelled sample content remain.
4. Visit content already brings together address, opening hours, directions, parking and appointments. Reviews remain conditional on a supplied review link; none were fabricated.
5. Vehicle photography, title, price and essential facts retain the existing desktop/mobile hierarchy. A new focus-aware link beside these facts jumps directly to buyer information.
6. Photo groups now work inside fullscreen as well as outside it. Horizontal swipes change photos; predominantly vertical gestures leave the selected photo alone, and the synthetic click following a swipe does not open fullscreen. Existing keyboard controls, counts and captions remain.
7. “What to know about this car” brings together supplied history, MOT, keys, insurance history, condition, warranty and included items. Missing entries explicitly say “Not supplied — please ask our team”; supplied text is not independently verified.
8. Viewing remains the primary action. The secondary action is now “Ask a question”; the existing phone/WhatsApp/PDF actions and mobile bar remain. Mobile regression checks cover overflow, gallery dismissal and action layout.
9. Vehicle-specific enquiries offer service history, condition and part-exchange question prompts. They append to, rather than replace, the customer's draft; repeated prompts and exceeding the 2,000-character limit are prevented. No enquiry is sent automatically and the API payload is unchanged.
10. Alternatives are capped at three. They must be the same make/model or match body type and comparable budget; merely sharing fuel/gearbox is insufficient. Known sold, reserved, archived or removed records are excluded. If nothing is relevant, no recommendations are displayed.

Validation: **137 frontend tests across 19 files passed**, and full workspace typechecking/builds passed. The existing approximately 531kB Vite chunk advisory remains. The 50-check relevant browser run initially passed 49; the remaining test had an invalid synthetic Touch event (missing its required identifier/target). After fixing the test event construction, all three new vehicle checks passed, bringing all 50 checks to passing across the full run and targeted rerun. No application change was needed for that test failure. The tests cover mobile stock position, return-to-stock behaviour, saved cars, comparisons, enquiries, galleries, settings and existing redesign journeys.

Desktop/mobile screenshot evidence was refreshed and visually inspected: [homepage desktop](screenshots/customer-stock-polish/home-1440.png), [homepage mobile](screenshots/customer-stock-polish/home-390.png), [vehicle desktop](screenshots/customer-stock-polish/vehicle-1440.png), [vehicle mobile](screenshots/customer-stock-polish/vehicle-390.png). A separate live browser inventory attempt was blocked by the account usage limit during the earlier session; this is not claimed as completed manual interaction. Physical-device swipe testing remains outstanding; browser touch coverage uses synthetic events.

Only frontend components/helpers, tests and documentation changed. Backend/database/API contracts, authentication, sales rules and production are untouched. Backend tests and the previously failing remote-photo PDF integration checks were not rerun for this frontend-only change. No merge, push or deployment.

## Quieter homepage and vehicle presentation — 23 September 2026

Implemented all eight approved refinements on `codex/luxxy-premium-ui-redesign`:

1. Kept the photographic dealership introduction and made the practical visit section smaller, titled **Plan your visit**, retaining hours, directions, parking, contact and configurable team content.
2. Stock cards now prioritise **View vehicle**, save and compare. Booking, telephone and WhatsApp remain available on the vehicle page, including the mobile action bar; no contact endpoint or capability was removed.
3. Added **View all stock** beside the arrivals heading and existing live availability count. It clears active filters and reveals all stock with focus moved to the results. The lower filtered-results action retains its existing behaviour.
4. Added a desktop sticky purchase/contact panel with a compact price reminder. The main price and vehicle facts retain their opening-page position. The existing mobile bar remains unchanged; desktop tests verify contact actions remain visible while reviewing buyer information.
5. The gallery shows a moving window of at most six thumbnails, plus a visible **View all N photos** fullscreen action. All images remain accessible using arrows, groups and keyboard Home/End, including across thumbnail windows. Manually checked photo 70 and Escape/focus return in the live browser.
6. The description starts with a factual overview drawn from supplied title/year/mileage/fuel/transmission, followed by up to four supplied feature highlights and the original description. No history, preparation or condition claims were generated.
7. S/N codes in buyer information are expanded to **Category S recorded** / **Category N recorded**. Unknown supplied text is preserved; missing history stays unconfirmed.
8. Missing buyer-information fields have specific enquiry links such as **Ask about MOT expiry**. They retain the car and prefill an editable question from a fixed allowlist. Stock loading cannot overwrite text the customer has already edited. No automatic submission or API payload change.

Validation: **139 frontend tests across 20 files passed; all 52 relevant browser checks passed; full workspace typechecking and builds passed**. The two new browser checks were repeated to refresh the default homepage screenshots after exercising View all stock. Browser coverage includes gallery keyboard/touch behaviour, stock focus/position, saved cars, comparison, booking, prompts and desktop sticky controls at mobile/tablet/desktop widths. Existing Vite sourcemap/chunk advisories remain. Backend/database tests and the separate remote-photo PDF integration issue were not rerun; no backend changed.

Fresh evidence: [home desktop](screenshots/home-vehicle-refinement/home-1440.png), [home mobile](screenshots/home-vehicle-refinement/home-390.png), [vehicle desktop](screenshots/home-vehicle-refinement/vehicle-1440.png), [vehicle mobile](screenshots/home-vehicle-refinement/vehicle-390.png). Matching `-viewport.png` files show the opening screen. Physical-device Safari/Android remains unverified. Sample dealer information and archived photography remain clearly labelled. No production access, migration, merge, push or deployment.

## Find my car remake — 23 September 2026

Replaced the nested questionnaire panels with a guided, two-column desktop layout and a single-column mobile journey. The new brief lists all five preferences, supports direct editing and offers a shortcut back to updated results once complete. Mobile uses a compact two-column brief beneath the questions. Completed steps are navigable; future unanswered steps remain disabled.

Retained the existing stock-only matching algorithm, budget flexibility, ranking, three recommendation layouts, save/compare controls and explanation of missed preferences. Removed redundant match-summary claims, decorative sparkle treatment and unsupported budget/fuel marketing claims. Added direct stock and enquiry links, including a useful contact action in the empty-stock state. No requests are submitted by the finder. Keyboard focus follows question/results changes, controls have comfortable touch targets, and selection/progress remain accessible.

Validation: all 139 frontend tests passed. The 19 browser checks covering the new finder and existing redesign journeys passed; the two finder checks were rerun after the final mobile-summary refinement. These exercise all five questions at 390px and 1440px, focus, answer editing, updating results, restart and the stock link. Full workspace typechecking and build passed (existing Vite large-chunk advisory remains). Screenshots: `docs/screenshots/car-finder-remake/` (questions and results at desktop/mobile widths). No backend, API, authentication, database or production changes. Matching remains a guide based on supplied stock data, rather than a suitability assessment or a sourcing service.

## Part-exchange WhatsApp journey — 23 September 2026

Replaced the part-exchange enquiry form with a dedicated four-step customer journey: current car (registration, make/model and mileage); condition (condition notes, keys, V5C and service history) plus photo guidance; required selection from current stock with vehicle photograph/details; and contact details followed by the complete message preview. Name and phone are required; email is optional. Earlier steps remain editable, values survive back/forward navigation within the form, and focus moves to each new step heading. Mobile removes the repeated desktop introduction. Existing non-part-exchange enquiries retain their submission flow.

The user chose WhatsApp-only delivery rather than adding photo-upload storage. The customer reviews the message and opens WhatsApp with it prefilled, then sends it and attaches photos in the chat. The site deliberately has no upload control and does not claim that photos or enquiries were submitted. The photo guide covers front/rear, both sides, interior, dashboard/mileage, wheels and damage. No personal-document photographs are requested. There is a showroom-call fallback if WhatsApp is unavailable. Answers are component-local, not stored in browser persistence, and this journey makes no enquiry POST. Consequently these WhatsApp requests do not automatically create staff-portal leads. No backend, database, API contract, authentication or sales-rule changes were made.

Validation: 141 frontend tests passed, including summary tests for zero mileage, document uncertainty, optional email and excluding registration age bands from actual plates. Twenty browser checks passed (three new part-exchange checks and seventeen existing redesign journeys); the three new checks were rerun after final visual refinements. Desktop/mobile tests validate required fields and vehicle selection, draft contents, consent, back navigation, preselected stock vehicles, no enquiry POST and the WhatsApp handoff without opening/sending an external chat. Full workspace typechecking/build passed; existing Vite chunk-size and tooltip sourcemap advisories remain. Reviewed the flow in the local browser and saved fresh 390px/1440px condition/review screenshots under `docs/screenshots/part-exchange-whatsapp/`. Production was not touched.

### Part-exchange delivery choice

Added a final-step choice between saving the details through the existing enquiry API then sending photos on WhatsApp, or sending the full message and photos in WhatsApp only. Website delivery requires email for the existing API; WhatsApp-only keeps email optional. The structured registration, mileage and condition fields are retained, with keys, V5C, history and the full brief included in the enquiry message. A successful website submission shows the enquiry reference and a separate WhatsApp photo link containing that reference. The form is disabled during submission; a failure retains the draft and supports retry or switching to WhatsApp. No backend/schema or production changes.

Validation: 141 frontend tests and four dedicated browser checks passed, including mocked website failure/retry, payload checks, reference-linked photo follow-up, optional/required email behaviour and WhatsApp-only delivery without an enquiry POST. Workspace typechecking/build passed (existing chunk-size advisory remains). Updated desktop/mobile screenshots in the same directory. This supersedes the WhatsApp-only limitation above: website submissions now create staff-portal enquiries, while the WhatsApp-only option does not.

## Full non-sales regression and fixes — 23 September 2026

Reviewed customer pages from the homepage through stock, vehicle details/PDFs, saved/compare, finder, enquiry types, booking management and both part-exchange options, plus staff work queue, leads/contact activity, channels and settings. Sales/deals and purchase-document/signing flows were excluded as requested. The detailed findings and coverage limits are in `docs/non-sales-regression.md`.

Fixed incorrect unknown-value sorting, insurance-history classification, blocked-storage crashes, registration searching/sharing, vehicle-load errors, comparison zero values and stale slots, stale booking cancellation state, enquiry query-string navigation, lost follow-ups after contact logging, failed staff-save handling and settings/channel error states. Follow-up fields remain locked throughout saving/refetching and preserve unsaved edits during background refresh. Enabled previously skipped TypeScript test files and fixed a false PDF-test extraction failure without reducing content/image assertions.

Final validation: **169 frontend tests (26 files), 73 non-sales browser checks, 10 brochure tests, 4 settings-content tests and 2 database-safety tests passed**. Full workspace typechecking and frontend/backend/mockup builds passed. Browser tests exercised 320–1440px layouts; fresh homepage, vehicle and lead screenshots at 390px/1440px are under `docs/screenshots/non-sales-regression/`. Remote vehicle photographs embedded successfully in both brochure browser checks. Existing Vite large-chunk advisory remains.

All actions used local fixtures or intercepted write requests. No live authentication/notification delivery or write-based database integration tests were run; those require a separate disposable test environment. No production data, migrations, backend runtime, API contracts, authentication or sales rules were changed. Nothing merged or deployed.

## Contact us and directions — 23 September 2026

Added `/contact` to the customer site and local preview, with links from desktop/mobile navigation, the footer and the homepage visit section. The page brings together telephone, WhatsApp, configured email, the existing enquiry form, a viewing link, opening hours, the showroom address, directions and arrival/parking guidance. Desktop uses two balanced columns; mobile stacks the sections and provides a direct, keyboard-accessible shortcut to the location details. Address copying announces its result, and settings-loading failures avoid showing an unverified location or opening hours.

All dealership information comes from existing onboarding settings. Sample addresses are clearly marked and suppress directions; a valid configured HTTP(S) map link enables directions and address copying when the address is no longer sample content. No location, parking provision or email address was invented. The enquiry form retains the existing API and response/reference behaviour. Optional showroom photography uses the existing configured image and shared component.

Validation: **172 frontend tests passed across 27 files**. **29 browser checks passed**, covering the five new contact scenarios and 24 existing mobile/navigation checks; the five contact scenarios passed again after the final mobile shortcut was added. Contact checks cover 320px, 390px and 1440px layouts, sample-address handling, configured directions/email/parking, address copying, navigation and mocked enquiry submission. Full workspace typechecking and builds passed; the existing Vite large-chunk advisory remains. Visually inspected desktop/mobile screenshots and checked the enquiry focus shortcut in the local browser. Fresh screenshots are in `docs/screenshots/contact-page/`.

Submissions were intercepted in tests; no real enquiries or WhatsApp messages were sent. Backend, database, API contracts, authentication, sales rules and production were unchanged. Real location/hours and optional email still need to be supplied through onboarding before publishing this template.

## Supplied dealership imagery — 23 September 2026

Placed all four user-supplied dealership visuals: showroom interior in the homepage introduction, forecourt beside Plan your visit, exterior beside Contact / How to find us, and reception alongside the message introduction. The current Mercedes hero and stock photographs remain unchanged. A shared `DealershipPhotograph` component preserves wide compositions at desktop and mobile widths, provides descriptive alternative text, lazy loading and consistent captions, and retains the existing unavailable-image state.

The images are clearly labelled illustrative template imagery. They appear only for Luxxy Motors without configured showroom/team photos; existing onboarding photos take priority and other dealerships retain their own imagery. No new API fields, backend changes, database writes or production changes. Assets are approximately 1MB combined instead of the approximately 9MB originals; source provenance is documented in `src/assets/README.md`.

Validation: **172 frontend tests and 33 browser checks passed**, including all four image loads/placements at 390px and 1440px, preserved hero, configured-photo priority, other-dealership isolation, contact form submissions with intercepted requests, mobile navigation and existing stock layouts. Full workspace typechecking/build passed, with the existing Vite large-chunk advisory. Reviewed the homepage introduction, visit section and Contact page visually; fresh section and page screenshots are under `docs/screenshots/dealership-photography/`, with Contact page screenshots also refreshed.

## Dedicated warranty page — 23 September 2026

Added `/warranty` to both application entry points. The page uses the current dealership style and configured warranty title/description, with showroom photography, a plain-language policy checklist, accessible questions/answers, a vehicle selector, telephone/WhatsApp contact and an existing-customer help route. The selector carries the car into the existing warranty enquiry page and WhatsApp draft. Sending the enquiry still uses the existing form/API; no new backend endpoint or business rule was introduced.

Warranty links in desktop/mobile navigation, footer and the homepage service section now open the dedicated page. The old homepage section anchor remains available. Links respect the warranty-enabled setting, configured CTA text remains intact, and the wide desktop navigation now has the same accessible label as the condensed navigation. The enquiry shortcut moves keyboard focus to its heading; mobile controls retain comfortable touch targets.

No provider, policy duration, price, claim limit or covered-parts promise was invented. The page identifies those as details to confirm for the chosen vehicle. Disabled warranty, failed settings, empty/failed stock and unavailable vehicle IDs all have explicit support paths. Illustrative showroom imagery remains captioned and follows the existing settings override rules.

Validation: **172 frontend tests and 36 browser checks passed**. Browser checks cover 320px/390px/1440px pages, accordion keyboard operation, enquiry focus, car-specific WhatsApp drafts and intercepted warranty enquiry submissions, settings overrides, disabled/error/empty states, mobile navigation and desktop navigation at 1024px/1440px/1536px. Workspace typechecking and all builds passed; the existing Vite large-chunk advisory remains. Desktop/mobile screenshots are saved under `docs/screenshots/warranty-page/`. Manually reviewed the page and accordion in the local browser. Production, databases, API contracts, authentication and sales rules were untouched; nothing merged or deployed.
