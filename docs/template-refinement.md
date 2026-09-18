# Dealership template refinement — 17–18 September 2026

Branch: `codex/luxxy-premium-ui-redesign`. Implementation commit: `3725f52`. This extends the reviewed redesign at `8eeefb2`.

The user asked for all six product improvements and the additional visual refinements, then clarified that this is a reusable dealership template. Sample content should remain until a business completes onboarding. The user explicitly authorised extending settings storage on this branch, without migrations or production access.

## Changes

| Area | Result |
| --- | --- |
| Identity | A drawn Luxxy wordmark replaces the generic initial tile. Header, footer and settings preview share one component. Other businesses use their configured name or uploaded logo. |
| Homepage | Vehicle photography is now visible in the first mobile screen. A configured homepage image takes precedence; otherwise the first photographed featured vehicle, then photographed stock, supplies the image. |
| Stock | Consistent photo proportions, title/variant space and tabular prices. Hidden hover-preview photographs are only mounted when needed. Search, filters, sorting, expanded results and the last vehicle position survive a trip to the detail page. |
| Vehicle detail | A less boxed-in summary, restrained gallery transition, caption-based Exterior/Interior/Details/Other navigation and a buyer-information ledger for history, MOT, keys, condition, warranty and included items. Missing information remains unconfirmed. |
| Visit information | Address, opening hours, appointments, parking, directions, team introduction and optional dealership/team photos and genuine review link. No review score or testimonial is invented. |
| Staff | Quick worklist filters use the existing server queues. A native selector saves vertical space on phones; larger screens have buttons. Lead pages retain customer, vehicle and next action in a small sticky context strip. Status fills and borders are quieter. |
| Performance | Staff and secondary customer pages load in separate route chunks, with an accessible loading state. Existing route guards and authentication behaviour remain in place. |
| Interaction | Short button feedback, restrained gallery fade, reduced-motion support, labelled photo fields, HTTPS validation and required photo descriptions in onboarding. Keyboard gallery behaviour and focus restoration are retained. |

## Onboarding and persistence

Staff portal → Settings now includes **Photos & visit**. Contact & hours continues to hold the address, postcode, map link and opening hours. Identity holds the business name, text/image logo and colours.

The optional `DealerSettings.presentation` object contains:

- `heroImageUrl`, `heroImageAlt`
- `showroomImageUrl`, `showroomImageAlt`
- `teamImageUrl`, `teamImageAlt`
- `teamIntroduction`, `visitInstructions`, `parkingInstructions`
- `reviewsUrl`, `includedInformation`

These values use the existing `GET/PATCH /api/dealer-settings` client and the existing `dealer_settings.config` JSONB column. No table, column, migration or deployment change is required. The existing staff authorisation is unchanged. Displayed opening hours remain informational; booking availability still comes from the existing scheduling API and rules. Each business must align those arrangements before launch. The OpenAPI schema, generated TypeScript client and generated server validation were updated together.

Existing settings without `presentation` remain valid. A PATCH from an older client that omits it preserves saved presentation content; partial presentation updates preserve omitted fields. An explicit empty string clears an optional field. URLs accept HTTPS or an empty value. Text and URL lengths are bounded. Onboarding requires an alt description when an image URL is supplied.

**No migration, database command, production settings save, merge, push or deployment was performed.** The local preview rejects writes. Browser tests intercept settings updates and other submissions in their own browser context; these do not persist to a database.

The only backend change is compatibility handling in the existing settings route, plus a pure merge helper and tests. Authentication, sales rules, stock imports and other APIs are unchanged. Client regeneration also picks up the already-documented staff-only contact-history error types from the existing OpenAPI source; it does not alter that endpoint or its protection.

## Stock data used by the buyer-information ledger

The UI reads supplied values from the vehicle, `specifications` or `sourceExtras`, in that order. It accepts these existing JSON keys without changing the stock API:

| Display | Accepted fields |
| --- | --- |
| Service history | `serviceHistory` |
| MOT expiry | `motExpiry`, `motExpiryDate` |
| Keys | numeric `numberOfKeys` or `keyCount`, or descriptive `keys` |
| Condition | `conditionNotes`, `condition` |
| Warranty | `warrantyDetails`, `warranty` |
| Included items | `includedItems`, `includedWithVehicle` |

Unsupported values do not become claims. Unknowns say “Please ask our team”. Zero keys remain zero. General handover copy is separate from individual vehicle facts and does not imply that every car is inspected, covered or supplied with particular accessories. No new vehicle facts are inferred from photographs.

## Visual and interaction review

The original mobile photo addition placed the first stock card at approximately 945px on a 390px-wide screen. Tighter introductory spacing, a smaller gap before search and removal of the mobile collection kicker bring it to approximately **890px**, while a 4:3 vehicle photograph starts at **223px**. The photograph retains its full mobile frame; search stays directly below it.

The first staff-filter layout wrapped to three rows on a phone. It was replaced by one labelled native selector on mobile. The larger-screen button row remains available, including counts and pressed states. New image-description fields have distinct accessible names, and onboarding section numbering remains sequential. The footer hours now span the phone width to prevent long configured times squeezing the dates; the heading says “Opening hours” rather than implying confirmed appointment availability.

Manual browser interaction in this pass covered the homepage, featured vehicle, photograph categories, enlarged gallery, Escape/focus return, mobile staff worklist selection and settings navigation. Automated click-through regression coverage additionally includes filtering and keyboard navigation, saved cars, comparison, booking, enquiry types, manual leads, staff dialogs, sales-readiness messaging, customer details, viewing links and signing fixtures.

Fresh screenshots cover **16 page types at 1440×1000 and 390×844**, plus first-screen captures and the new onboarding section: **42 PNG files** under [`screenshots/template-refinement/`](screenshots/template-refinement/).

| Page | Desktop | Mobile |
| --- | --- | --- |
| Homepage/stock | [View](screenshots/template-refinement/home-desktop.png) | [View](screenshots/template-refinement/home-mobile.png) |
| Vehicle detail | [View](screenshots/template-refinement/vehicle-desktop.png) | [View](screenshots/template-refinement/vehicle-mobile.png) |
| Saved vehicles | [View](screenshots/template-refinement/saved-desktop.png) | [View](screenshots/template-refinement/saved-mobile.png) |
| Comparison | [View](screenshots/template-refinement/compare-desktop.png) | [View](screenshots/template-refinement/compare-mobile.png) |
| Viewing booking | [View](screenshots/template-refinement/booking-desktop.png) | [View](screenshots/template-refinement/booking-mobile.png) |
| Part exchange | [View](screenshots/template-refinement/part-exchange-desktop.png) | [View](screenshots/template-refinement/part-exchange-mobile.png) |
| Customer details | [View](screenshots/template-refinement/customer-details-desktop.png) | [View](screenshots/template-refinement/customer-details-mobile.png) |
| Viewing link | [View](screenshots/template-refinement/viewing-desktop.png) | [View](screenshots/template-refinement/viewing-mobile.png) |
| Signing | [View](screenshots/template-refinement/signing-desktop.png) | [View](screenshots/template-refinement/signing-mobile.png) |
| Staff desk | [View](screenshots/template-refinement/staff-desk-desktop.png) | [View](screenshots/template-refinement/staff-desk-mobile.png) |
| Lead detail | [View](screenshots/template-refinement/lead-desktop.png) | [View](screenshots/template-refinement/lead-mobile.png) |
| Deal | [View](screenshots/template-refinement/deal-desktop.png) | [View](screenshots/template-refinement/deal-mobile.png) |
| Leads | [View](screenshots/template-refinement/leads-desktop.png) | [View](screenshots/template-refinement/leads-mobile.png) |
| Channels | [View](screenshots/template-refinement/channels-desktop.png) | [View](screenshots/template-refinement/channels-mobile.png) |
| Settings | [View](screenshots/template-refinement/settings-desktop.png) | [View](screenshots/template-refinement/settings-mobile.png) |
| Find my car | [View](screenshots/template-refinement/finder-desktop.png) | [View](screenshots/template-refinement/finder-mobile.png) |
| New onboarding section | [View](screenshots/template-refinement/onboarding-desktop.png) | [View](screenshots/template-refinement/onboarding-mobile.png) |

Full-page screenshots show fixed or sticky action bars at the capture viewport position. First-screen captures are provided separately for home, vehicle, staff desk and settings; the action bars do not repeat while using the application.

## Validation

| Check | Final result |
| --- | --- |
| Complete frontend Vitest suite | 123 passed across 16 files |
| Browser suite, including screenshot capture | 55 passed |
| New backend settings compatibility/validation tests | 4 passed |
| Existing backend database-safety guard tests | 2 passed |
| Full workspace typecheck | Passed |
| Full workspace production build | Passed: website, API server and mockup sandbox |
| Full database integration/migration suites | Not rerun: no prepared disposable local test database was available, and the user prohibited running migrations |

Commands:

```sh
NODE_OPTIONS=--no-experimental-webstorage pnpm --filter @workspace/luxxy-motors test
pnpm --filter @workspace/api-server test:settings
pnpm --filter @workspace/api-server test:safety
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' LUXXY_LOCAL_PREVIEW=1 LUXXY_QA_SCREENSHOTS=1 LUXXY_QA_SCREENSHOT_SET=template-refinement pnpm --filter @workspace/luxxy-motors test:mobile-layout --workers=2
pnpm run typecheck
PORT=4175 BASE_PATH=/ NODE_ENV=production pnpm run build
```

Node 25 requires the documented web-storage compatibility flag for these jsdom tests. A run without it failed in storage-dependent tests; the corrected run passed. A workspace build without `PORT` failed in the existing mockup-sandbox configuration; the documented production build command passed. Earlier mobile position and browse-session test failures were corrected before the final run.

Backend tests verify validation, JSON serialisation and legacy/partial update preservation without connecting to PostgreSQL. The browser test verifies the real settings client payload and refreshed UI with a mocked response. Actual SQL persistence and authenticated end-to-end acceptance still need a prepared, isolated development environment.

## Measured performance and remaining work

- Main production JavaScript: **795.78KB → approximately 527.83KB**, about 34% smaller; gzip **224.37KB → approximately 158.61KB**, about 29% smaller. The portal is a separate approximately 144KB chunk, loaded on demand.
- At a cold 390×844 local preview load, initial image requests fell from **18 to 2**. The first visible stock card contains one image until a preview is requested.
- These are local bundle/request measurements, not field LCP or mobile-4G claims. Authentication/shared libraries still contribute to the initial bundle, which remains above Vite’s 500KB advisory threshold. The existing tooltip sourcemap warning also remains; neither fails the build.
- Each business must replace the sample address, hours, visiting instructions, team introduction and handover text. Upload/configure genuine dealership and team photography and a genuine review URL. No synthetic people, showroom claim or fabricated review was added. Without supplied photographs, the optional team area is intentionally text-only.
- Vehicle-photo grouping uses supplied captions, so uncaptioned or unrecognised images remain under Other. Real stock photography still varies in lighting and composition; onboarding gives a consistent shooting-order guide without altering a vehicle’s appearance.
- Live stock quality, physical iPhone/Safari and Android checks, real authenticated staff sessions, provider-backed signing/PDF delivery and database integration acceptance remain outside this local fixture review.
- Recommended next step is business onboarding and isolated staging acceptance. Replit removal, hosting migration and production rollout remain separate milestones.

## Changed files

- `artifacts/api-server/package.json`
- `artifacts/api-server/src/lib/settings-content.ts`
- `artifacts/api-server/src/routes/dealer-settings.ts`
- `artifacts/api-server/src/settings-content.test.ts`
- `artifacts/luxxy-motors/preview/settings.ts`
- `artifacts/luxxy-motors/preview/stock.ts`
- `artifacts/luxxy-motors/public/brand/luxxy-wordmark.svg`
- `artifacts/luxxy-motors/src/App.tsx`
- `artifacts/luxxy-motors/src/components/brand/wordmark.tsx`
- `artifacts/luxxy-motors/src/components/car-card.tsx`
- `artifacts/luxxy-motors/src/components/dealer-settings-panel.tsx`
- `artifacts/luxxy-motors/src/components/dealership-visit.tsx`
- `artifacts/luxxy-motors/src/components/gallery.tsx`
- `artifacts/luxxy-motors/src/components/layout.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-card.tsx`
- `artifacts/luxxy-motors/src/components/portal/lead-detail.tsx`
- `artifacts/luxxy-motors/src/components/portal/portal-ui.tsx`
- `artifacts/luxxy-motors/src/components/portal/work-queue.tsx`
- `artifacts/luxxy-motors/src/components/route-loading.tsx`
- `artifacts/luxxy-motors/src/components/route-scroll-reset.tsx`
- `artifacts/luxxy-motors/src/components/showroom-photo.tsx`
- `artifacts/luxxy-motors/src/components/ui/button.tsx`
- `artifacts/luxxy-motors/src/config/dealer.ts`
- `artifacts/luxxy-motors/src/index.css`
- `artifacts/luxxy-motors/src/lib/browse-session.ts`
- `artifacts/luxxy-motors/src/lib/buyer-information.test.tsx`
- `artifacts/luxxy-motors/src/lib/buyer-information.ts`
- `artifacts/luxxy-motors/src/lib/home-navigation.ts`
- `artifacts/luxxy-motors/src/lib/vehicle-photography.ts`
- `artifacts/luxxy-motors/src/pages/car-detail.tsx`
- `artifacts/luxxy-motors/src/pages/home.test.tsx`
- `artifacts/luxxy-motors/src/pages/home.tsx`
- `artifacts/luxxy-motors/src/preview.tsx`
- `artifacts/luxxy-motors/tests/mobile-stock-position.spec.ts`
- `artifacts/luxxy-motors/tests/template-refinements.spec.ts`
- `artifacts/luxxy-motors/tests/visual-qa-capture.spec.ts`
- `docs/template-refinement.md`
- `docs/ui-redesign.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/dealerPresentation.ts`
- `lib/api-zod/src/generated/types/dealerSettings.ts`
- `lib/api-zod/src/generated/types/index.ts`

Screenshot files are listed in the review table above.
