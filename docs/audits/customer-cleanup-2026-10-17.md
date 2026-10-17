# Customer website cleanup — 17 October 2026

Implemented locally after approval of the customer-site audit. The shared website code changes apply to each dealership when released; this work did not change live dealer settings, stock, credentials or schedules. No deployment, migration, customer enquiry, appointment or provider email was submitted.

## Completed

- Homepage: show the introduction while stock loads, keep featured browsing manual, remove duplicated carousel cards and the autoplay control, consolidate reassurance/services, remove the homepage recently-viewed strip, and point “Why Buy From Us” at the actual reassurance section with keyboard focus.
- Stock: quick choices refine existing filters and reset pagination; incompatible minimum prices clear when a lower quick budget is chosen. Explicit price/mileage/year sorts include reserved vehicles in the correct order; only the default stock order groups reserved cars last.
- Follow-up stock browsing: the fixed header slides away on deliberate downward scrolling on phone/tablet, and returns on upward scrolling or near the top. Open menus and keyboard navigation keep it visible. Layout spacing stays stable, touch jitter/overscroll are ignored, and reduced-motion preferences remove the transition. Desktop navigation is unchanged. The temporary Wi-Fi preview was rebuilt for this follow-up.
- Vehicle follow-up: the same header behaviour applies on vehicle pages and resets visibly at each new route. Route entry resets the scroll position instantly (rather than inheriting smooth anchor scrolling); vehicle content has a brief opacity-only entry with no page movement, disabled for reduced motion. The loading photo now reserves the gallery's 4:3 ratio. Saved stock return-position behaviour is retained. This follow-up passed 31 focused tests, TypeScript, production build and the rebuilt temporary phone preview.
- Cards: at most three ordinary highlights, mileage shown once in a readable compact format, supplied equipment fallback retained, reserved/confirmed category labels preserved. Whole-card links no longer repeat a separate “View vehicle” action. Failed photographs have a retry action distinct from missing photography.
- Footer: remove the repeated invitation and filler. Keep configured branding, legal links, contact information and real hours. The phone footer shows today's hours and a link to the full hours; wider screens show upcoming dates.
- Contact/warranty: use direct contextual enquiries, remove the duplicate contact form, remove generic travel/parking blocks when the dealer has supplied no instructions, and consolidate repeated warranty explanations. No provider, cover period or warranty inclusion has been invented.
- Vehicle: caption-based photo groups with All retained, photo loading/failure/retry states, confirmed insurance category near price, contextual WhatsApp messages, and a service-record request that opens a car-specific enquiry. Private service photos are still shared by authorised staff through the existing email workflow, never exposed as public assets.
- Running costs: only compare enough unique visible cars with compatible data. MPG/CO2 comparisons require the same fuel and explicit matching measurement-cycle evidence. Without sufficient evidence, retain the supplied figure without a coloured judgement. Insurance retains the established fixed group scale.
- Booking: the humorous car greeting appears on the first step only, with a compact selected-car summary afterwards. An empty date offers a customer-initiated check of the next permitted date and direct contact options; availability is checked before any time is offered.
- Part exchange: three steps, registration/mileage first, optional condition/paperwork details, 30-minute tab-local draft recovery and a fresh review before sending. The mileage limit now agrees with the backend.
- Enquiries: remove the repeated form introduction, preserve car/question context, and avoid claiming a request definitely failed after an uncertain network/server response.
- Private purchase page: “Paid in full” for a zero balance, no empty collection panel, and a prominent link to the newest issued invoice. Invoice verification distinguishes a temporary service problem from an unavailable link and offers recovery/contact actions.

Print, share, Call, WhatsApp, saved cars, source-backed vehicle facts and the existing booking safeguards remain available. Withdrawn chat, comparison, online card reservations and recent handovers were not re-enabled. Historical records were not removed.

## Verification

- Combined frontend suite: **679 tests passed across 97 files**.
- Frontend TypeScript check and production build passed. Existing non-blocking large-bundle/source-map warnings remain.
- Subsequent minor wording/layout changes were checked with focused tests and TypeScript; final build checked again.
- Browser review on 390px phone, 820px tablet and 1280px desktop viewports. Verified filter preservation, manual featured navigation, correct “Why Buy” destination/focus, two-column tablet cards, photo group selection, car-specific service enquiry text, booking date recovery and compact second-step layout. No horizontal page overflow in those checks.
- Existing browser specs were updated for manual featured browsing and current links. They were syntax-checked, not executed as an automated browser suite. Browser checks used the in-app browser.
- Preview screenshots are under `output/ui/customer-cleanup/`. Preview stock, address/hours and reviews are local fixtures and do not certify live dealer facts.

## Remaining work and content dependencies

1. **Persistent enquiry retry protection.** This needs a dealer-scoped submission receipt and transactional notification outbox, with a schema migration and concurrency/restart tests. Clearer error wording does not provide idempotency. See [the detailed follow-up](customer-reliability-follow-up-2026-10-17.md).
2. **Dealer-verified content.** Actual showroom address, opening hours, real photography and approved warranty facts must come from the operator/dealer where missing. A description/structured insurance-category disagreement needs source correction and operator review; categories are not guessed from free text.
3. **Sticky action bar.** Not introduced in this cleanup: the existing visible actions remain, avoiding another overlay over the customer's photos or forms.
4. **Release.** Review and deploy this local work separately. Earlier portal notifications/settings work and its pending email-drafts migration are separate existing changes in the same checkout; they were preserved and have not been commissioned by this cleanup.
