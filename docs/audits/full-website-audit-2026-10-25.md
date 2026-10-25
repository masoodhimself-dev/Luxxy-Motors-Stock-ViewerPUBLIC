# Luxxy website, portal and settings audit

Date: 25 October 2026. Branch: `codex/full-website-audit-2026-10-25`.

Baseline: `cf2c077d58859c59cf6649f0c502f108fb65945d`, the deployed booking release. Work was isolated in `/private/tmp/luxxy-vehicle-sheet-render-release`; unrelated work in the original checkout was not included. These audit changes have **not been deployed**.

## Outcome

The audit found real defects in settings publication, stock filtering, customer selection, private sharing recovery and staff editing. The fixes preserve existing booking, sales, payment, invoice, permission and import rules. No database migration is required.

Browser coverage comprises **37 page/state combinations at three widths: 111 distinct responsive checks**. The widths were 390, 820 and 1440 CSS pixels. None of the measured states exceeded its viewport width. This is browser viewport testing, not physical iPhone/iPad testing.

The settings-to-customer matrix is in [Settings wiring audit](settings-customer-wiring-2026-10-25.md). Additional route and journey findings are in [Customer journey audit](customer-journeys-2026-10-25.md).

## Defects corrected

| Area | Defect and effect | Correction |
| --- | --- | --- |
| Featured cars | Saved featured IDs and their order did not affect customer stock/carousel order. | Recommended order now honours the selection, ignores stale IDs and keeps reserved cars after available cars. Explicit customer sorts still take priority. |
| Automatic shortcut | Its count included case variants and detailed automatic labels, but the destination matched only the exact word `Automatic`. | Shortcut and results now agree; the native transmission select also retains the canonical linked value. |
| Services | Saved service titles were neither exposed clearly nor used by homepage cards. | Added the existing title fields to Services and connected their saved values to cards. |
| Warranty | Some saved warranty wording was ignored. The default homepage CTA was inappropriate as an on-page enquiry action. | Custom policy wording and deliberate CTA edits are honoured; the unchanged homepage default becomes “Send a warranty enquiry” on the warranty page. Selected cars keep their contextual action. |
| Brand colours | Certain saved colours were silently replaced with a different hue. | Retain the chosen hue and apply the existing readability adjustments. Stored settings are not rewritten. |
| WhatsApp number | Public destinations handled `07`, `+44`, `0044` and invalid values inconsistently. | Use the shared normalizer for links; invalid/extension destinations are not offered. Validate nonblank dealer numbers before publication. |
| Footer | Booking label ignored the saved CTA. | Use the configured booking label and retain current-vehicle context. |
| Enquiry topics | Customers were invited into dealer-disabled services. | Hide promotional links for disabled services without changing direct enquiry acceptance or losing an already-entered part exchange. |
| Part exchange | A dealer without WhatsApp could offer an unusable WhatsApp-only path and misleading photo instructions. | Keep the website enquiry usable, explain the photo handoff accurately and preserve answers if a confirmed number becomes unavailable. Loading/error states do not silently change the selected method. |
| Imported facts | Comparison missed structured insurance history and keys that were actually supplied. | Reuse the structured history normalizer and the correct imported keys label. Never infer a verified category from advert prose. Comparison remains disabled by release policy. |
| Vehicle sharing | A success message could survive navigation to another car. | Reset that notice when the vehicle changes. |
| Phone QR sharing | Reusing the same phone tab for a second QR could retain the previous customer's message and recipient. | Clear previous content before loading the new link, abort/ignore stale responses and ignore completion notices belonging to the old pack. Failed second links cannot restore old customer content. |
| Invoice verification | Bare or truncated verification links could render a blank screen. | Show the existing unavailable-link help and contact action; incomplete links do not trigger a verification request. No invoice bytes, calculations or issued records changed. |
| Sales email action | An invoice email action did not explain or reflect a platform email pause/failed availability check. | Gate the existing action on effective availability, show the reason and retry control; print, download and WhatsApp remain independent. Server permissions remain authoritative. |
| Cars customer selector | Same-name enquiries looked identical, risking selection of the wrong conversation. | Options show name, enquiry reference and available email. Tests verify the exact selected enquiry ID reaches the composer. |
| Description editing | SPA navigation could discard typed, unsaved vehicle-description edits. | Retain edits per vehicle in authenticated, memory-only query cache for up to 24 hours. Returning explains recovery, resets review approvals and checks the latest server version. Nothing is automatically saved or published. Identity changes clear the cache. |
| Platform Refresh | The header refreshed overview data but left the selected dealer workspace stale. | Recheck access and reload the current workspace while preserving its tab. Keep pending state through both requests, retain last values on error and reject late results for a different selected dealer. |
| Retired wording controls | Six fields edited interface sections that no longer exist. | Remove those controls from the editor while preserving stored values and compatibility. |
| Service validation | Empty or oversized text could fail only at the server, without useful field navigation. | Enforce the existing 120/300/80 character title/description/button limits and navigate to the relevant error. No new API rule. |
| Draft preview | It showed a disabled hero introduction and ignored several colour/photo/review settings. | Use the public theme/readability calculations and honour introduction visibility, supplied image alt/focus and review heading. It remains explicitly a sample, not a full page preview. |
| Settings guidance | Hints misstated hero/footer copy, featured-photo selection, dark header logo use and vehicle-sheet truncation. | Correct the hints and neutral colour swatches. Photo focus now appears in its inline preview. |
| Settings visibility/search | Individual services claimed visibility even when the homepage section was hidden; wording search ignored saved custom phrases. | Explain master-section visibility and search saved dealership copy as well as field names/defaults. |
| Small presentation defects | Warranty had duplicated dividers/spacing; specification groups said “1 details”. | Keep one warranty section divider and use the correct singular count. |
| Unknown URLs | Server returned HTTP 200 even when the SPA displayed a missing page. | Return 404/noindex without canonical/schema for unknown paths. Known staff, customer capability and Clerk routes retain their prior status/privacy treatment; API handlers are unchanged. |

## Browser inspection coverage

Every row marked “three widths” was opened/rendered at 390, 820 and 1440 pixels. Screenshots and measurements were saved locally. Not every nested mutation in a page was performed live.

| Page/state | Environment and checks | Result / qualification |
| --- | --- | --- |
| Homepage | Live Luxxy, three widths; hero/search, shortcuts, carousel, services, reviews, visiting and footer | Fits. Automatic count and destination agreed for the live sample. Settings-related defects above were reproduced in source/tests and corrected locally. |
| Stock results and filters | Live Luxxy, three widths; pagination/show more, make/model dependency, budget range, transmission | Fits. Mercedes narrowed the model choices. Displayed budget bounds reflected current dealer stock. |
| Auto Trader vehicle | Live Luxxy, three widths; gallery, facts, contact/actions, content and print entry | Fits; no broken images in the measured state. Call popup showed the correct Sunday closure and next opening. |
| Cazoo vehicle | Live Multi Choice demo, three widths; richer specifications, costs, equipment and checks | Fits; no broken images in the measured state. Source fields remain distinct while shared booking/sales systems stay unchanged. |
| Saved cars | Live Luxxy, three widths; save, saved-list appearance and removal | Test save removed afterwards; original saved count restored. |
| Contact | Live Luxxy, three widths; address, contact methods, opening hours and directions | Fits. No phone call or outbound message made. |
| Warranty | Live Luxxy and corrected local page, three widths | Corrected local title/action, spacing and divider visually verified. |
| General enquiry | Live Luxxy, three widths; labels, vehicle summary and contact choices | Fits. No customer form submitted live. |
| Part-exchange enquiry | Live Luxxy, three widths; staged entry, vehicle selection and instructions | Fits. Website/no-WhatsApp submission and draft fallback tested with mocks. |
| Delivery enquiry | Live Luxxy, three widths | Fits. Existing enquiry rules retained. |
| Test-drive booking | Live Luxxy, three widths; date/time availability and form layout | Fits. No live appointment created/cancelled during this audit. Availability and booking rules covered by regression suites. |
| Comparison disabled state | Live Luxxy, three widths | Correct policy fallback; saved cars remain available. |
| Portal Home / Inbox / Test drives | Live Shore Drive, each at three widths after loading | No horizontal overflow or visible error alerts in the inspected states. No real conversation/status/appointment changed. |
| Portal Cars / Sales | Live Shore Drive, each at three widths after loading | No overflow in overview states. Expanded Cars/editor/customer-selector behaviour additionally reviewed and regression tested locally. |
| Portal Reservations / History | Live Shore Drive, each at three widths after loading | Fits; real records left unchanged. |
| Six Settings categories | Live Shore Drive: Dealership, Website, Bookings, Emails/documents, Team, Advanced; each at three widths | Fits. No unlabelled inputs found in the inspected rendered categories. No live settings published. |
| Eight Website Settings subpages | Local preview: Brand, Homepage, Photos/visits, Services, Selling points, Page wording, Vehicle sheets, Review/publish; each at three widths | Fits; no visible error alerts. Local service-title publication reached both homepage and warranty page; original local title restored afterwards. Invalid WhatsApp publication produced an inline error. |
| Invoice/phone-sharing recovery | Local preview, each at three widths | Helpful recovery instead of blank or stale customer information. Valid second-QR replacement covered by regression tests. |
| Platform overview | Isolated local preview, three widths | Fits. Live central platform required administrator sign-in, so authenticated production platform actions were not exercised. Workspace Refresh is covered by component tests. |

The 37 measured states include both the before/after warranty states and grouped settings/portal pages. Raw measurements: `output/full-website-audit-2026-10-25/browser-checks.json` in the original workspace. Earlier loading-state entries are retained as evidence; later loaded entries supersede them.

## Settings contract and accuracy checks

- Public settings use an allowlisted response; private integration credentials are separate and masked. Public settings carry revision/ETag and no-store handling. Publish/restore require permission and expected revision.
- Verified host determines the tenant. Dealer changes invalidate the shared settings cache. Staff identity changes clear authenticated query data, including retained description edits.
- Showroom opening hours and appointment availability are intentionally separate. Their existing explicit copy/apply flow remains; this audit does not silently synchronize them.
- Platform pauses remain authoritative. Dealer switches cannot enable products currently paused by platform policy, including comparison, online card reservations, chat and recent handovers.
- Sharing/template saves do not send messages. Required facts/links remain outside editable prose. Changing a prepared message invalidates its older QR confirmation state.
- Issued invoice sharing uses the archived document. Tax guide delivery remains invoice-email-only. Google review reminders and sale/appointment/customer follow-ups remain manual.
- Source review covered private purchase, booking management, invoice verification, declarations, video recording/sharing, staff/customer phone uploads and retired sales routes. No new public legal/finance/help pages were invented: legal links are configured destinations and About is a homepage section.

## Checks completed

- Full frontend regression suite: **191 files, 2,061 tests passed** (`vitest run --maxWorkers=2`, 92.76 seconds). This includes QR replacement, recovered drafts, paused email actions, platform refresh and duplicate-name customer selection.
- Full workspace `build` completed successfully, including library, frontend and API typechecking. Existing bundle-size/sourcemap warnings remain; no new dependency or failed build step.
- Settings/editor focused suites, customer journeys, shell/theme/footer, Sales, platform, Cars customer selection, description recovery, phone sharing and invoice recovery all passed their focused runs.
- Backend public-page SEO/HTTP fixtures: **11/11 passed**. Unknown URLs, private route status/privacy, API handling and data lookup boundaries tested with injected fixtures.
- Backend settings contract fixtures: **14/14 passed**. Feature-policy fixtures: **2/2 passed**. Fixtures used local/in-memory data; no production database.
- `git diff --check` passed. No database migration or package dependency added.

Aggregate logs are saved with browser evidence in `output/full-website-audit-2026-10-25/`: `frontend-tests.log`, `workspace-build.log` and `browser-checks.json`.

The first broad runs encountered resource-related Sales test timing failures during concurrent build/browser work. The focused Sales suite passed; one helper now waits for the actual asynchronous summary instead of assuming a one-second render. The final whole-suite run uses two workers to avoid resource contention, with production assertions intact.

## Setup issues and unverified boundaries

1. **Shore Drive setup needs completion.** Its published contact phone/WhatsApp/email, showroom address and opening hours were blank/unconfirmed in the settings inspected. Website checks already flag setup omissions. Public booking was disabled. These are saved configuration choices or missing setup data, not failures to render supplied details. No values were invented or changed.
2. Physical iPhone/iPad Safari, camera permissions, orientation, native date/select controls and real video recording/compression were not tested on hardware in this audit.
3. No real Resend delivery, incoming email reply, WhatsApp send, staff “I've sent it” production mutation, signature, payment or live sale/booking completion was performed. These paths have source and regression coverage, not a fresh external end-to-end send claim.
4. Valid private purchase/upload/declaration links were not freshly issued for a live customer. Their recovery/authorization logic was reviewed. Existing invoice PDF calculation/printing logic was not redesigned.
5. Live platform administration was signed out. The platform workspace refresh fix was tested locally, not against a signed-in production workspace.
6. A native discard-draft confirmation stalled one browser automation tab. Further layout and recovery checks continued in fresh tabs. The local publication test title was restored; completion of that native confirmation is unverified. This is not treated as proof of an application defect.
7. External configured legal/social/directions destinations and actual email-client rendering are outside these responsive page checks. Ordinary browsing/contact analytics may record views; no customer messages or financial/stock records were intentionally changed.

## Recommended next improvements

| Priority | Improvement | Practical benefit |
| --- | --- | --- |
| Next | Add a “Shown on” link beside conditional settings, opening the relevant customer section. | Staff can immediately see what a setting controls and why it is hidden. Extend the existing Website checks rather than adding a competing setup checklist. |
| Next | Add a changed-field summary to the existing publish review. | Owners can review “phone changed, warranty hidden, booking hours changed” before publishing one shared draft. Keep current revision protection. |
| Next | Build a full unpublished-page preview using real stock and the draft settings at phone/tablet/desktop sizes. | Avoid publishing merely to inspect a logo, title or featured order. Keep current small preview clearly labelled until then. |
| Next | Show platform pauses and showroom/booking-hour differences directly beside affected controls. | Reduce confusion without merging two intentionally separate rules. |
| Later | Let customers add part-exchange photos directly after submitting their enquiry. | Remove an extra app handoff and match images to the correct conversation. Requires a separate upload/privacy/storage design, not added in this audit. |

No feature suggestions above were silently introduced as new business rules. Imports, Grok delivery, schedules, customer-message automation, invoices and payments remain unchanged by this work.
