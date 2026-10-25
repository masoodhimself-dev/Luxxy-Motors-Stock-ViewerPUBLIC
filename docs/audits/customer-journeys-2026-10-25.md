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
