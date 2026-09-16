# Luxxy Motors UI/UX redesign

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

## Verification (16 September 2026)

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

## Review and remaining work

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
