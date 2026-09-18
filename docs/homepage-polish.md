# Homepage composition refinement — 18 September 2026

Branch: `codex/luxxy-premium-ui-redesign`.

This implements the six approved homepage recommendations. Changes are confined to the website, local preview fixtures, tests and documentation. Backend code, stored settings, API contracts, authentication, stock filtering rules and sales workflows are unchanged. No database connection, migration, production change, push, merge or deployment was performed.

## What changed

1. **Hero photography:** the photograph preserves its complete frame, with its vehicle name and price in a separate caption below. On desktop, a 480px photograph sits beside the introduction; phones retain a full-width 4:3 photograph. The preview features the existing indoor MG photograph. Featured stock and custom hero photographs remain controlled by the existing onboarding settings.
2. **Earlier stock:** dealer assurances sit beside the introduction on desktop. The stock heading, quick filters, count and display controls share a compact area. The redundant collection label and several layers of spacing were removed. At 390px, the first preview stock card begins at approximately 794px, compared with the previous recorded 890px.
3. **Compact search:** search, filters, sorting and the results action share one row on desktop. Mobile uses two rows, with a full-width results action on the narrowest phones. Sort labels are shorter; all underlying sort values are unchanged. Reset appears when there is something to reset, and the active count is displayed on the Filters button. Existing keyboard submission, result focus and search/filter behaviour remain intact.
4. **Tighter vehicle cards:** model and variant sit together, with less space before the price and specifications. Single-column phone cards no longer reserve unused heading space. Wider grids retain enough heading space for typical variants. Save, compare, viewing, telephone and WhatsApp actions are retained.
5. **Photographic dealership introduction:** the existing showroom-photo setting now supplies a photograph beside a shorter introduction and compact dealership points. Decorative numbering was removed. The photograph is no longer repeated in the practical visit section. Without a configured image, the introduction retains a compact text layout. Team content, reviews, hours, address and visiting instructions remain available below.
6. **Grounded opening copy:** the frontend template default is “Clear information, straightforward advice and viewings at your pace.” With no custom announcement, the town comes from the configured address: “Used cars in Harrow”, for example. Existing custom copy is respected. No saved business copy or backend defaults have been overwritten; existing businesses can adopt the new wording through onboarding.

Onboarding includes short guidance about the photo framing, the new showroom-photo placement and the town label. No new storage fields are required.

## Photography and remaining limits

The local preview uses existing archived stock photographs. Its introduction photograph is explicitly described as sample archive photography in its alternative text, and the preview retains its archived-stock notice. It is illustrative template content, not evidence of any business's premises. Each dealership should supply its own showroom photograph and consistent stock photography through the existing settings. This pass cannot remove clutter or improve the lighting of the original archive photographs.

Physical iPhone/Safari and Android checks remain outstanding. The existing tooltip sourcemap diagnostic and Vite's 500KB chunk advisory remain; the main website chunk is approximately 527KB / 159KB gzip. Database integration suites were not run, because this frontend task does not require database access and no disposable local test database was prepared.

## Visual evidence

Fresh captures at 1440×1000 and 390×844 are in `docs/screenshots/homepage-polish/`:

- `home-desktop.png`, `home-mobile.png`: full pages.
- `home-desktop-viewport.png`, `home-mobile-viewport.png`: opening screens.
- `introduction-desktop.png`, `introduction-mobile.png`: dealership introduction.
- `vehicle-card-desktop.png`, `vehicle-card-mobile.png`: card spacing.
- `filters-desktop.png`, `filters-mobile.png`: expanded controls.

Manual browser review covered the desktop opening, 390px and 320px phone layouts, expanding filters, choosing a make and clearing the selection, card spacing and the dealership introduction. The automated suite also checks saved/compare, galleries, booking, customer links and staff journeys across responsive widths using local fixtures and intercepted writes.

## Files changed

- `artifacts/luxxy-motors/src/pages/home.tsx`
- `artifacts/luxxy-motors/src/pages/home.test.tsx`
- `artifacts/luxxy-motors/src/components/filters.tsx`
- `artifacts/luxxy-motors/src/components/car-card.tsx`
- `artifacts/luxxy-motors/src/components/showroom-photo.tsx`
- `artifacts/luxxy-motors/src/components/dealership-visit.tsx`
- `artifacts/luxxy-motors/src/components/dealer-settings-panel.tsx`
- `artifacts/luxxy-motors/src/config/dealer.ts`
- `artifacts/luxxy-motors/src/index.css`
- `artifacts/luxxy-motors/preview/settings.ts`
- `artifacts/luxxy-motors/tests/visual-qa-capture.spec.ts`
- This report, `docs/ui-redesign.md` and ten screenshots.

## Final validation

- Frontend: **123 tests passed in 16 files**.
- Browser: **55 checks passed**, including both screenshot captures, against the read-only local preview. Responsive checks cover 320–1440px.
- Backend settings: **4 tests passed**. Database safety: **2 tests passed**, without a database connection.
- Complete workspace typechecking passed.
- Website, API server and mockup workspace builds passed.
- `git diff --check` passed.

Commands:

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @workspace/luxxy-motors test
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' LUXXY_LOCAL_PREVIEW=1 LUXXY_QA_SCREENSHOTS=1 LUXXY_QA_SCREENSHOT_SET=homepage-polish pnpm --filter @workspace/luxxy-motors test:mobile-layout --workers=2
pnpm --filter @workspace/api-server test:settings
pnpm --filter @workspace/api-server test:safety
PORT=4175 BASE_PATH=/ NODE_ENV=production pnpm run build
```

An initial unit assertion was updated because the filter count intentionally moved from Reset to Filters. The new screenshot collector now locates the make field by its accessible combobox name. A temporary JSX formatting typo was corrected after it interrupted two checks during live reloading; the final complete run used unchanged source and passed all 55 checks. No final test failures remain.

## User-supplied hero artwork — 18 September 2026

The user subsequently provided the dark blue Mercedes image. The homepage now uses an optimised bundled JPEG of that image for the Luxxy identity when no custom hero photograph or featured vehicle is selected. The original artwork and source file are unchanged. The supplied car remains fully framed at the reviewed desktop and phone sizes.

The caption is “Explore our current stock” and links to the collection without attaching a real vehicle's model/price to illustrative artwork. Custom homepage images take precedence, followed by explicit featured-vehicle selections. Other dealership identities retain stock photography, so the Luxxy number plate does not appear automatically on another business's template. Onboarding explains these choices. No backend or storage changes were needed.

Fresh full-page and opening-screen captures are in `docs/screenshots/brand-hero/`. Four additional frontend regressions cover brand artwork without a price, other businesses, featured selections and custom-photo precedence.

Validation for the hero replacement: **127 frontend tests**, **55 browser checks**, full workspace typechecking and all workspace builds passed. Captures use `LUXXY_QA_SCREENSHOT_SET=brand-hero`; they also verify that the bundled image loads at its expected resolution and that clicking the hero reaches the stock heading. Existing build advisories remain. Backend/database integration tests were not rerun for this frontend asset change. No production access, merge, push or deployment was performed.
