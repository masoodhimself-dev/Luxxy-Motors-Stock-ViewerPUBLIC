# Settings to customer website wiring audit — 25 October 2026

Scope: source and automated checks against the exact-live release checkout, branch `codex/full-website-audit-2026-10-25`. Browser review belongs to the main audit. No deployment, production settings writes, customer messages, stock imports or database changes were performed for this work.

## Fixed defects

1. **Six editable phrases had no customer interface.** Page wording still offered the old service eyebrow, old contact visit/form text, and redundant warranty supporting copy. Their customer sections no longer exist. Those six controls are retired; saved fields remain in the shared draft and are not removed or rewritten. Warranty details heading/introduction remain editable and are now consumed by the existing policy disclosure (customer journeys fix).
2. **Service titles were hidden in settings and ignored on the homepage.** Services now exposes the existing API `title` field. Homepage cards use these saved titles (customer journeys fix). Existing title values are preserved.
3. **Service description limits were only a hint.** The editor allowed empty or oversized service titles, descriptions and buttons and sent them to the server, where validation failed without useful field navigation. Enforced the existing API's 120/300/80 character limits, added local required/length errors, and route errors back to Services. No API/business-rule change.
4. **Invalid WhatsApp contacts could be published.** Contact settings now validate a nonblank WhatsApp number using the same normalizer as customer links. A formatted valid UK or international number stays as entered; invalid values are explained before publishing. Blank remains allowed.
5. **Draft preview misrepresented the website.** It always displayed the hero introduction even when its public toggle was off and ignored chosen page/card/text colors. Preview now respects `showHeroDescription`, supplied photo alt/focus and review heading, and uses the customer theme's same contrast-safe surface/text/button calculations.
6. **Several settings descriptions contradicted actual consumers.** Corrected false claims that hero subcopy appears in the footer, featured selections determine the homepage picture, a footer logo is used only in the footer, and every word is always included on the one-page vehicle sheet. Colour picker fallback swatches now match the customer's actual neutral defaults. Photo focus also applies to the inline photo preview.

7. **Service visibility labels ignored the homepage master switch.** Individual cards now say Service enabled/disabled, and a clear notice explains when the homepage service section is hidden. These labels do not change service flags or publication state.
8. **Wording search ignored actual dealership copy.** Search now matches saved custom phrases as well as field names and defaults, ignoring incidental leading/trailing spaces.

## Public website settings matrix

All rows refer to `/api/dealer-settings` unless noted. Consumers are frontend paths beneath `artifacts/luxxy-motors/src/`. Public settings are merged with the platform feature policy in `lib/dealer-settings-context.tsx`; a dealership toggle does not override a platform pause.

| Setting / fields | Customer consumers | Conditions / verified scope |
| --- | --- | --- |
| `identity.name`, `logoText`, `logoAsset` | `components/layout.tsx`, `brand/wordmark.tsx`, `customer-footer.tsx`; contact, booking, vehicle sheets | Uploaded logo with text fallback. Name used in customer messages and document branding. Header logo can differ on dark home header. |
| `identity.brandColors.primaryHsl`, `accentHsl` | Layout -> `lib/customer-theme.ts`; buttons, links, footer; vehicle sheet branding | Customer text colors may be adjusted to remain readable. No saved color is rewritten. |
| `presentation.pageColour`, `panelColour`, `headingColour`, `linkColour` | Layout -> customer theme variables; shared customer CSS; draft preview | Neutral defaults are #f5f6f7 / #ffffff / #192a36 / #215a7e. Contrast correction is presentation-only. |
| `presentation.footerLogoUrl` | Layout's dark homepage header; customer footer | Header logo remains fallback when footer logo omitted. |
| `presentation.faviconUrl` | Layout favicon effect | Public icon, independent of text logo. |
| `contact.phone`, `whatsapp`, `email` | Contact/footer, call dialog, vehicle contact buttons, booking contact details, vehicle sheets | Public contact links. WhatsApp uses international-number normalizer. `googleReviewUrl` is separate from displayed reviews link. |
| `contact.googleReviewUrl` | Sale Google review reminders and review email/WhatsApp preparation | Staff manually prepare/send; saving this URL does not send messages. Must be an HTTPS Google review URL. |
| `address.street`, `city`, `region`, `postcode`, `mapsUrl` | `lib/dealership-location.ts`; contact, showroom panel, booking, footer and vehicle sheets | Directions fall back to supplied address. Sample/unconfirmed addresses receive existing warnings. |
| `hours[].days`, `times` | `lib/showroom-hours.ts`, showroom visit panel, call dialog, footer upcoming hours, customer chat opening information | UK timezone. Unknown/ambiguous hours do not invent an opening. Appointment timetable remains separate. |
| `legal.companyName`, `companyNumber`, `vatNumber` | Customer footer and vehicle sheets/document brand data | Omitted when absent. Issued invoices keep their snapshots. |
| `legal.termsUrl`, `privacyUrl`, `cookieUrl` | Customer footer and privacy notices | HTTP/HTTPS link validation; blank allowed. |
| `social.instagram`, `facebook`, `twitter` | Customer footer | Blank links omitted. |
| `hero.announcement`, `copy`, `primaryCta` | `pages/home.tsx` and `components/hero-stock-search.tsx` | Announcement may use demo-specific text; homepage headline/search button use saved copy. |
| `hero.subcopy`, `presentation.showHeroDescription` | Homepage hero supporting paragraph | Intro shown only when toggle true. Not rendered in customer footer. |
| `featuredVehicleIds[]` | Featured/stock ordering via rolling stock and stock-context consumers | Chooses/reorders cars; does not choose the hero background. Missing/unavailable IDs are ignored by current public stock selection. |
| `presentation.featuredEnabled` | Homepage/rolling-stock section | Off hides featured section. Does not hide normal stock results. |
| `presentation.visitEnabled` | Homepage dealership-visit section | Visit/team content only shown while section enabled. Contact page remains separate. |
| `presentation.servicesEnabled` | Homepage service cards | All public service cards hidden when false. Individual enabled flags still govern corresponding service routes/actions. |
| `warranty.{enabled,title,description,ctaLabel}` | Homepage service card; `pages/warranty.tsx`; enquiry service gating | Title/description/button are existing API fields. Disabled service is not advertised; existing-owner help fallback remains. Selected-vehicle enquiry CTA stays consistent. |
| `delivery.{enabled,title,description,ctaLabel}` | Homepage service card; `pages/enquire.tsx` delivery enquiry | Service toggle does not alter sale delivery/payment rules. |
| `partExchange.{enabled,title,description,ctaLabel}` | Homepage service card, navigation, enquiry form | Also gated by platform `partExchange` feature. Existing part-exchange sales logic unchanged. |
| `bookViewing.ctaLabel` | Header/mobile navigation, vehicle page, showroom panel | Existing normalization standardizes legacy “Book a Viewing”. Stored title/description are legacy and no longer offered as controls. Form wording uses `websiteCopy.viewing*`. |
| `testDriveBooking.enabled` | Customer booking form and availability API | Platform `testDriveBookings` must also permit booking. Existing bookings/manage links keep their rules. |
| `testDriveBooking.confirmationMode` | Customer form/submission success, staff decision controls | Instant and staff-approval outcomes remain distinct. Backend authoritative. |
| `durationMinutes`, `bufferMinutes`, `minimumNoticeHours`, `dailyCapacity`, `daysAhead`, `weeklyHours`, `blockedDates` | Booking availability API -> `components/test-drive-booking.tsx`, management and staff booking flows | UI shows returned slots. Showroom hours copy is explicit preview/apply; does not silently synchronize. Numeric limits are existing API rules. |
| `testDriveBooking.instructions` | Booking confirmation/manage information and appointment notifications | Up to existing 2,000-character limit. No automatic messages added. |
| `presentation.heroImageUrl`, `heroImageAlt`, `heroImagePosition` | Homepage background and Settings photo preview | Brand/demo or first public stock photo can be fallback when no custom hero photo. Not tied to featured selections. |
| `presentation.teamImageUrl`, `teamImageAlt`, `teamIntroduction` | `components/dealership-visit.tsx` | Visit section must be enabled, and supplied team content exists. |
| `presentation.visitInstructions`, `parkingInstructions` | Contact page, showroom panel and booking visit information | Corresponding headings only appear when relevant content supplied. |
| `presentation.includedInformation` | `pages/car-detail.tsx` buyer information | Dealer-wide copy; never converts unknown vehicle checks into verified facts. |
| `presentation.reviewsEnabled`, `reviews[]`, `reviewsUrl` | Homepage `customer-reviews.tsx`, `vehicle-reviews.tsx`, draft preview | Review list requires enabled flag and nonempty entries. Read-all URL separate from request-review URL. Editing sourced review removes its verification markers. |
| `whyBuy[]`, `trustItems[]` | Homepage dealership reassurance | Detailed points take priority; legacy short points remain fallback. Both lists preserved. |
| `brochure.useWebsiteColour`, `accentColour`, `footerNote` | `lib/vehicle-sheet-data.ts`, `vehicle-sheet-branding.ts` and one-A4 vehicle sheet | Custom color retained when switching inheritance. Long optional content truncates with ellipsis; QR goes to canonical vehicle page. No invoice changes. |
| `onlineReservation.*` | Customer reservation UI/API | Release policy currently disables this product; editing controls hidden and public policy prevents activation. Existing saved values retained. |
| `presentation.comparisonEnabled`, `websiteCopy.compare*` | Compare page/compare controls | Release policy currently disables comparison; controls/wording hidden. Saved cars remain independent. |
| `recentHandovers.*` | Recent handover section | Release policy currently disables; settings controls hidden. Saved legacy values preserved. |

## Editable page wording matrix

Inventory remains 46 keys for compatibility. Three navigation keys are standard labels rather than editable. Six removed-section keys are retired. The remaining 37 keys are offered where enabled by release policy; comparison's two keys are currently hidden.

| Key(s) | Customer output |
| --- | --- |
| `stockTitle`, `stockIntroduction` | Stock results title and optional introduction (`pages/home.tsx`) |
| `servicesHeading` | Accessible service section heading (screen readers); card titles come from Services |
| `featuredHeading` | Rolling stock section heading |
| `visitHeading`, `teamHeading` | Homepage visit section, conditional team subsection |
| `reviewsHeading` | Homepage and vehicle review sections |
| `contactTitle`, `contactIntroduction`, `contactTalkHeading`, `contactDirectionsHeading` | Existing Contact page title/intro/talk/address sections |
| `contactBeforeHeading`, `contactParkingHeading` | Conditional supplied visiting/parking sections |
| `warrantyEyebrow`, `warrantyEnquiryHeading` | Warranty page intro and enquiry panel |
| `warrantyDetailsHeading`, `warrantyDetailsIntroduction` | Existing warranty policy-checklist summary and expanded introduction |
| `savedEyebrow`, `savedTitle`, `savedDescription` | Saved cars page |
| `compareTitle`, `compareDescription` | Comparison page, gated off by current release policy |
| `viewingTitle`, `viewingDescription` | Guided test-drive form heading/intro |
| `generalTitle/Description`, `deliveryTitle/Description`, `warrantyTitle/Description`, `part_exchangeTitle/Description` | Matching enquiry type, selected dynamically in `pages/enquire.tsx` |
| `vehicleSpecificationHeading`, `vehicleDescriptionHeading`, `vehicleInformationHeading`, `vehicleFeaturesHeading`, `vehicleSimilarHeading` | Corresponding vehicle-page content sections when vehicle data exists |
| `navigationStock`, `navigationContact`, `navigationPartExchange` | Standard navigation labels deliberately used; legacy overrides retained, editing hidden |
| `servicesEyebrow`, `contactVisitHeading/Description`, `contactMessageHeading/Description`, `warrantySupportingCopy` | Retired interface controls; underlying stored values retained for compatibility |

## Other settings paths traced

| Settings | Endpoint / consumer | Result |
| --- | --- | --- |
| WhatsApp QR sharing enabled | `/api/staff/phone-sharing-settings` -> sharing panels/server gate | Turning off blocks new customer sharing links. Existing links/expiry/revocation and “I've sent it” follow existing rules. Public WhatsApp button is separate. |
| WhatsApp templates | `/api/staff/whatsapp-templates` family -> sharing message preparation | Staff can edit prepared message. Template save does not send. Existing required link placeholders validated. |
| Email connection and templates | Dealer integrations + email template components/server email preparation | Sender/reply routing/template settings are separate from public `contact.email`. No credentials are public website settings. |
| Website chat | `/api/staff/chat/settings`; public chat config -> `components/customer-chat.tsx` | Button label, greeting and offline text consumed; enabled/automatic answers/portal notifications retain server behavior. |
| Invoice settings/terms | Sales paperwork settings -> invoice settings API/PDF document snapshot | Future documents only. Existing issued invoices, payments and customer records are protected; no invoice edits in this audit. |
| Search visibility | `/api/staff/search-visibility` -> published business metadata checks | Checks use published details, not unpublished draft; IndexNow requires explicit staff action and provider enablement. |
| Stock connection | Staff stock-connection API -> imported stock | Credential/import acceptance is separate from website content. This audit did not enable/import/schedule anything. |

## Validation completed

- 111 tests passed across 13 settings/editor/draft/image/review/sharing/template/search/paperwork/settings-hub files.
- The final clarity changes added two tests; the 15 tests in the affected two component files passed on rerun.
- Frontend TypeScript typecheck passed.
- New regressions cover retired fields preserving saved content, service title publication, empty service CTA blocking, existing API max lengths, invalid versus valid formatted WhatsApp numbers, hero intro toggle, supplied alt/review heading and themed readable draft surfaces.
- Browser widths, real device behavior, sender provider delivery and live production writes require the main audit or separately authorized live test. No claim of external end-to-end delivery is made here.

## Remaining usability opportunities

1. Show a read-only platform-pause explanation beside Bookings/Part exchange settings, so a dealer understands why enabling their own switch may not make the public action available. Both layers should remain independent.
2. A full unpublished-page preview would help dealers inspect text, photos, and colors in context before publishing. Current preview is explicitly a content/color sample, and “View published showroom” remains labeled accurately.
3. A small per-setting “Shown on” route preview would reduce trial and error for conditional sections; targeted hints now explain selected conditional wording fields.
4. The existing shared-draft publish step could list changed groups/fields (contact, bookings, website) so staff can review exactly what will publish without searching each tab. Revision/conflict protection must remain.
5. Same-origin dealer reassignment could theoretically leave an old browser settings draft. Current multi-tenancy uses verified host and normal dealer domains isolate session storage; no in-portal same-origin dealer switch was found. Future switching should add an explicit tenant identifier to draft scope.

## Platform and expanded Cars source follow-up

Reviewed the platform overview/dealer list/onboarding/workspace tabs, including stock source, DNS, features, staff, imports and demos; expanded Cars media, description and linked-customer controls were also inspected in source.

Fixed platform header Refresh, which previously reloaded only `/api/platform/overview` and left the selected dealership's credentials, staff, domains, status and import records stale. It now rechecks access and reloads the selected workspace, retaining its current tab. During both reads Refresh stays disabled/busy; a failed workspace refresh keeps the last details and gives a retry message. A stale response cannot replace a different dealer. A denied overview refresh hides dealer controls and skips its workspace read. Refresh error copy is generic enough to remain accurate after either domain work or a staff invitation update.

Validation: 21 platform tests passed, including three new cases for changed credentials/members/status, pending/error/retry, and denied access. Frontend typecheck passed. These are local fixture tests only; no domain, key, permission or real membership was changed.

Two Cars issues were referred to the responsible agent: duplicate linked-customer names lacked reference/email disambiguation, and unsaved description text could be lost on SPA navigation despite the browser-unload warning. Their fixes and verification belong to that agent's audit results.

## Requested usability follow-up — implemented locally

- **A complete publication change summary.** Review & publish compares the most recently loaded public settings with the complete shared draft. It groups changed fields under Dealership details, Website and Bookings. Each change expands to the exact Published and Your draft values and links back to its editor. It includes reordered featured cars, review-content edits even when counts stay the same, cleared values, custom wording and appointment hours. Long values remain readable in a wrapping scroll area; they are not cut from the comparison. This is a read-only calculation; saved revisions, conflict protection and publication payloads are unchanged.
- **Published-page destinations and conditions.** Settings section headings link to applicable published pages. Every active page-wording control has a Shown on link to its actual page/form. Vehicle wording uses an existing vehicle page, or explicitly offers choosing a car from published stock when none is available. Conditional hints explain team/visit, reviews, parking/visit instructions, vehicle description/equipment and similar-car sections. Links are labelled as published versions, open safely in a new tab and do not pretend to show unpublished changes.
- **Availability and hours notices.** Integrated the separate read-only notice components from the settings contract work in booking enablement, appointment hours, showroom hours, part exchange and the final booking review card. They explain confirmed feature unavailability or an unconfirmed check and compare confirmed showroom/appointment hours. They never silently change the timetable, feature gate or booking rules.
- **Consistent discard confirmation.** Replaced the native browser confirmation for the shared settings draft only with the existing accessible AlertDialog. Keep editing receives initial focus. Cancellation keeps every draft edit. Explicit discard restores the latest loaded publication and clears only the shared settings draft; it does not save settings or touch customer records. Upload/save pending guards remain in place.

Validation: 39 focused tests passed across five files (change summary helper, panel, wording editor, website wording and availability notices), and frontend typecheck passed. The panel regression exercises edits across all three groups, the comparison/edit return path, publication and the now-empty comparison. Discard tests cover safe cancellation, explicit discard, original values, unrelated browser data retained and no network write. The main audit supplies browser and full draft preview results separately.
