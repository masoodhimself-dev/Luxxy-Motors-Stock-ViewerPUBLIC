# Customer journey source audit — 25 October 2026

Scope: homepage/stock, vehicle detail, contact, warranty, saved cars, comparison and enquiry entry pages, plus their existing enquiry and part-exchange consumers. Browser verification is being performed separately by the primary audit. No deployment or customer messages were performed by this audit.

## Fixed

| Finding | Change | Regression evidence |
| --- | --- | --- |
| Settings allowed staff to choose featured vehicles, but customer stock and homepage carousel ignored the selected IDs and order. | Recommended ordering now uses the saved selection, ignores stale IDs and retains reserved vehicles after available stock. Explicit customer sorting still overrides recommendations. The hero image remains independent. | Homepage and stock ordering, reserved grouping, stale ID and price-sort test. |
| Automatic shortcut counted supplied `automatic` and `Automatic (DCT)` records but its destination filtered only exact `Automatic`. | Destination matching now agrees with the shortcut count; other selected transmission labels are trimmed and case insensitive. | Both variant labels produce the promised two results. |
| Homepage services displayed hardcoded headings despite saved service titles. | Display the saved nonblank title, with the existing label as fallback. Disabled services remain absent. | Customized warranty/delivery headings and disabled part exchange tested. |
| Warranty call to action and policy-detail wording settings were ignored. | The general warranty action uses a customized CTA label; the unchanged template `Learn About Warranty` remains a homepage action and becomes `Send a warranty enquiry` on the warranty page. Selecting a car retains the contextual action. Existing policy disclosure uses its saved heading and introduction. | Custom wording, unchanged/blank template CTA, selected vehicle URL and contextual CTA verified. |
| Comparison said insurance history was missing when it existed in a structured nested source field. | Reuse the same structured history normalizer used by vehicle detail. No inference from description text. | Nested Category S and explicit clear-history records tested together. |
| Comparison could say keys were missing despite imported history containing them. | Fixed `buyerInformation`'s mismatch between the expected `Keys supplied` and actual `Keys included` record label. | Imported `KEYS` value appears in the comparison. |
| Other-enquiry links promoted services disabled in dealership settings. | Hide disabled delivery, warranty and part-exchange topic links. Do not promote adding a new part exchange when the service is disabled; retain an already-entered exchange. Existing direct enquiry routes and acceptance rules remain available. | Disabled service navigation and direct warranty question retained. |
| A dealership without WhatsApp still offered WhatsApp-only part exchange, then disabled the final action. Success also instructed the customer to send a nonexistent photo handoff. | Offer the website flow with accurate photo instructions. If the confirmed showroom number disappears, preserve answers and switch an unsent WhatsApp choice back to the website. Loading/error states do not trigger that switch. | Full mock website submission without WhatsApp and mid-flow number removal verified. |
| Warranty had two adjacent section dividers and excess spacing. | Remove the inherited introduction divider and redundant margin, leaving one policy-section divider. | Primary audit to visually verify at tablet and phone widths. |
| Copy/share success text could remain when navigating to another car. | Clear the share status when the displayed vehicle changes. | Reversible presentation correction; existing sharing tests remain passing. |

## Validation

- Seven focused test files: **106 tests passed** (`home`, `car-detail`, `contact`, `warranty`, `compare`, `enquiry-form`, `part-exchange-form`).
- Frontend TypeScript check passed.
- `git diff --check` passed.
- Existing booking components, API contracts, invoice calculations, payments, stock-import behaviour, customer delivery and permissions were not changed.
- No physical-device or actual external send was performed here; primary audit owns browser coverage.

## Follow-on opportunities

1. Settings readiness summary: show which customer-facing sections are visible and flag missing opening hours, contact details or WhatsApp configuration before staff publish their website.
2. Preview the saved featured order and service wording at phone/tablet widths directly from Settings, using real current stock rather than an unrelated placeholder.
3. Consider a customer part-exchange photo upload after enquiry submission. It would remove the current handoff to WhatsApp, but needs a separate design and permission/storage review; this audit does not introduce it.

## Full unpublished website preview follow-up

Settings → Review → Preview your draft appearance → **Open full website preview** now shows the actual Homepage, Stock, Vehicle, Contact and Warranty components with the unsaved settings and current public stock. Phone (390 px), iPad (820 px) and desktop (1440 px) render their own responsive layouts; the frame scales down to fit smaller staff screens and scrolls independently. Vehicle choice uses current public stock, with sold, archived and hidden vehicles excluded.

The preview renders static React markup using a separate in-memory router and query cache. Only public dealership settings, stock and the existing feature flags enter that cache. The generated page runs inside an opaque, script-free sandbox with connections, forms and embedded documents blocked. Navigation, form controls and buttons are disabled. Native information disclosures remain keyboard-accessible and can be opened without JavaScript. The preview does not mask horizontal overflow. Gallery photographs use visible static images rather than animation/loading states that require mounted JavaScript. No customer effects, analytics, submissions, timers, metadata updates, publication or local/session-storage writes run. Saved cars, recent views, stock filters and unfinished customer enquiry/exchange details are not read from the staff device.

The server-rendering code loads only when staff open the full preview; the production build keeps `react-dom/server.browser` in a separate lazy chunk. Missing current stock or feature access produces an explicit error instead of example cars or invented access settings. Live booking availability, video playback and operational demo banners are explicitly excluded; this is a layout/content review, not a simulation of customer transactions.

Validation: **115 tests passed** across preview renderer/modal, SettingsPreview, Home, CarDetail, Warranty, EnquiryForm and SavedCarsProvider. Actual-page snapshot tests assert draft copy, service switches, featured order, hours, responsive search markup, zero fetches, zero storage reads/writes, zero dispatched window events and unchanged page title/body theme. Modal tests cover page/vehicle/device selection, sandboxing and unavailable-data handling. Frontend typecheck, production build and `git diff --check` passed. Browser verification remains with the primary audit; no physical-device claim is made here.

Independent-preview review follow-up: removed preview-only horizontal overflow suppression so layout defects remain visible; native `<details>/<summary>` disclosures retain keyboard focus and can open in the scriptless frame. Navigation/contact/submission controls remain disabled and the sandbox/CSP are unchanged. Vehicle gallery snapshots use plain eager images at opacity 1 and omit the JavaScript-dependent loading indicator, preserving the real gallery's animation/retry behavior outside preview. A nonempty hero/two-photo fixture now checks this path. **47 tests passed** across renderer, modal, SettingsPreview and Gallery (31 real-gallery tests), and frontend typecheck/diff checks passed.

Browser follow-up: rapid page/device changes exposed a WebKit iframe navigation defect: a frame mounted under the new title with the previous snapshot before its effect replaced `srcDoc`. Snapshots are now associated with their exact input request (draft, stock, feature flags, page, device width and vehicle). The frame is absent until matching markup is ready, so a new frame's first document is always correct. Static rendering remains inside the effect. **12 preview tests passed**, including an assignment-level regression cycling all five pages across all three device sizes and changing vehicle, plus frontend typecheck and diff checks.

Browser sizing follow-up: Radix mounts its portal after the preview's initial effect, so the original ref-based one-shot observer could miss the stage and keep the fallback 390 px width. The stage now binds through callback-ref state and attaches its observer when the actual element becomes available. A real-dialog regression verifies 1376 px available width gives a 96% desktop preview, a later 900 px container gives 63%, and the observer disconnects on close. **13 preview tests**, frontend typecheck and diff checks passed.

Empty-stock follow-up: if refreshed stock removes the last vehicle while Vehicle is selected, show a visible “No current vehicle is available to preview. Choose another page.” status, remove the old frame and retain the chosen page. The refresh/next-page regression passed with all five modal tests; frontend typecheck and diff checks passed.
