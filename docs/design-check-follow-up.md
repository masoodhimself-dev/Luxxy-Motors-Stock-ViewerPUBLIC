# Design check: implemented follow-up

18 September 2026 · final verification 21 September 2026 · `codex/luxxy-premium-ui-redesign`

All eight recommendations have been implemented, preserving the current visual identity. Production, backend code, API contracts, authentication, database schema/migrations and sales/signing rules are unchanged. The implementation details and validation commands are recorded in [ui-redesign.md](ui-redesign.md#design-check-follow-up--18-september-2026).

## What changed

| Review area | Result |
| --- | --- |
| Signing | Complete supplied document text is readable, with revision context and a direct jump from the agreement. |
| Settings | Tab-local drafts survive navigation/reload, show unpublished status and clear only on publication or explicit discard. The showroom link accurately identifies published content. |
| History wording | Recorded categories no longer imply verified completed repairs. |
| Accessibility | Stronger specification labels and form boundaries; larger secondary actions; document focus navigation. |
| Stock | Honest empty-inventory message, valid budget ranges and removable applied filters. |
| Staff | Simpler sale dialog with stable footer; wider stage/action/date fields. |
| Onboarding | Colour picker/hex editor, unchanged HSL storage contract, practical readiness checklist and photography guide. |
| Visual polish | Compact team/visit layout and customer-task footers; comparison differences toggle and readable sticky headings; consistent navigation/day labels. |

The homepage hero and vehicle images are retained. The photography recommendation is implemented as guidance for dealership onboarding, not alteration of stock photographs or invention of missing company content. Physical-device and hosted-authentication checks remain outstanding.

## Fresh screenshots

| Page / state | Desktop | Mobile |
| --- | --- | --- |
| Homepage | [Desktop](screenshots/design-check-fixes/home-desktop-viewport.png) | [Mobile](screenshots/design-check-fixes/home-mobile-viewport.png) |
| Full homepage / visit section | [Desktop](screenshots/design-check-fixes/home-desktop.png) | [Mobile](screenshots/design-check-fixes/home-mobile.png) |
| Vehicle | [Desktop](screenshots/design-check-fixes/vehicle-desktop.png) | [Mobile](screenshots/design-check-fixes/vehicle-mobile.png) |
| Comparison | [Desktop](screenshots/design-check-fixes/compare-desktop.png) | [Mobile](screenshots/design-check-fixes/compare-mobile.png) |
| Signing / complete pack | [Desktop](screenshots/design-check-fixes/signing-desktop.png) | [Mobile](screenshots/design-check-fixes/signing-mobile.png) |
| Booking details | [Desktop](screenshots/design-check-fixes/booking-details-1440.png) | [Mobile](screenshots/design-check-fixes/booking-details-390.png) |
| New sale | [Desktop](screenshots/design-check-fixes/new-sale-1440.png) | [Mobile](screenshots/design-check-fixes/new-sale-390.png) |
| Lead fields | [Desktop](screenshots/design-check-fixes/lead-fields-1440.png) | [Mobile](screenshots/design-check-fixes/lead-fields-390.png) |
| Unpublished draft | [Desktop](screenshots/design-check-fixes/settings-draft-1440.png) | [Mobile](screenshots/design-check-fixes/settings-draft-390.png) |
| Colour controls | [Desktop](screenshots/design-check-fixes/colour-controls-1440.png) | [Mobile](screenshots/design-check-fixes/colour-controls-390.png) |
| Readiness checklist | [Desktop](screenshots/design-check-fixes/onboarding-checklist-1440.png) | [Mobile](screenshots/design-check-fixes/onboarding-checklist-390.png) |
| Empty inventory | [Desktop](screenshots/design-check-fixes/empty-stock-1440.png) | [Mobile](screenshots/design-check-fixes/empty-stock-390.png) |

The evidence folder contains 60 screenshots. All use archived stock and synthetic customer/staff records. No real signatures, enquiries or settings changes were submitted.

## Results

- 134 frontend tests and 48 guarded local backend tests passed.
- Workspace typechecking and all builds passed. The existing Vite main-chunk size warning remains.
- The targeted contrast/capture checks passed on six routes plus desktop/mobile form states; input boundaries measured 3.58:1. No low-contrast text candidates were detected in these states.
- Browser coverage: **63 of 65 checks passed after the capture collector fix and targeted rerun; two existing PDF-photo checks still fail.** The full run initially passed 62 checks, failed the two PDF checks and timed out during desktop image collection. The collector now requests lazy photographs concurrently, bounds the wait and attaches unavailable-image details. Both desktop/mobile whole-site captures then passed (2/2). All seven new design regression checks passed in the complete run.

### Remaining issues

- The PDF opens, but the latest real-host browser checks found **8 embedded photographs instead of the expected 58** at both viewport sizes. The unchanged backend loader has an 18-second overall image-fetch deadline with four workers. A separate read-only request for one stock image took about 2.44 seconds; slow external downloads are consistent with the partial result, but this is not a conclusive diagnosis. The tests have not been weakened and no backend change was made. This needs a separate PDF image-loading reliability fix before release.
- Physical iPhone/Safari and Android interaction, screen readers and hosted Clerk authentication remain unverified in this local Chromium preview.
- Dealer-supplied photography and confirmed business content are still needed for each template installation. Drafts are tab-local and expire after 24 hours; they are not shared between devices.
- The existing approximately 531kB main JavaScript chunk warning remains. No visual clipping or horizontal page overflow was found in the reviewed desktop/mobile states.

### Changed files

- `artifacts/luxxy-motors/preview/portal.ts`: representative supplied signing document.
- `artifacts/luxxy-motors/src/components/`: `dealer-settings-panel.tsx`, `dealership-visit.tsx`, `enquiry-form.tsx`, `filters.tsx`, `layout.tsx`, `brand/colour-field.tsx`, `brand/colour-field.test.tsx`, `portal/activity-composer.tsx`, `portal/deals-panel.tsx`.
- `artifacts/luxxy-motors/src/lib/`: `settings-draft.ts`, `settings-draft.test.tsx`.
- `artifacts/luxxy-motors/src/pages/`: `signing.tsx`, `car-detail.tsx`, `compare.tsx`, `home.tsx`, `home.test.tsx`; shared `src/index.css`.
- `artifacts/luxxy-motors/tests/`: `design-review-fixes.spec.ts`, `visual-qa-capture.spec.ts`.
- `docs/ui-redesign.md`, this report and `docs/screenshots/design-check-fixes/`.

No merge, push, deployment, production access or migration was performed.
