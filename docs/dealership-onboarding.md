# Dealership onboarding and editable content

The staff portal (`/portal`, Settings) now opens a ten-step setup. Dealers can jump to any step, use Previous/Continue, or switch to all sections. Changes remain a browser-tab draft until Review & publish. Drafts expire after 24 hours; failed saves retain the edits. This is a settings editor, not a drag-and-drop page builder.

## Content inventory

| Website area | Controls |
| --- | --- |
| Brand | Dealership name, text logo, header logo URL, separate footer logo, browser icon, primary/accent colours, page/panel/heading/link colours |
| Contact and visits | Telephone, WhatsApp, email, street/city/region/postcode, map link, opening-hours rows, parking and appointment instructions |
| Photography | Separate hero, showroom, team, forecourt/visit, contact and reception images; accessible descriptions; hero crop focus |
| Homepage | Announcement, headline, supporting introduction, search button label, featured vehicle selection/order, featured strip/visit/services visibility, optional hero description, service and section headings |
| Navigation | Browse Stock, Contact us and Part Ex labels; test-drive label comes from the booking settings |
| Browse Stock | Page title and introduction; actual vehicles, facts, prices and photographs come from the stock feed |
| Vehicle detail | Specification, description, buyer-information, features and similar-stock headings; dealer details, reviews and service availability inherit shared settings |
| Enquiries | Titles and introductions for general enquiries, test drives, delivery, warranty and part exchange |
| Contact page | Main title/introduction, talking/visiting/directions/parking/message section wording and two independent image placements |
| Warranty | Existing service title/description/button, supporting text and detail/enquiry headings |
| Saved and comparison | Page headings and introductory text |
| Reviews and trust | Existing JSON review editor, visibility, source link, verified/invited metadata, review heading, trust points and why-buy reasons |
| Services | Warranty, delivery, part exchange, recent handovers; online reservation switch, deposit amount and terms |
| Print/PDF | Existing brochure settings; dealer identity/contact details inherited from shared configuration |
| Footer and company | Logo, introduction, contact/address/hours, social profiles, company/VAT numbers and policy links |

Page wording is searchable and grouped by page. A blank override restores the standard wording shown below the field. Text is rendered as text, not HTML. The typed field catalogue lives in `artifacts/luxxy-motors/src/lib/website-content.ts`.

## Deliberate boundaries

- Images use hosted URLs; this installation has no direct media-upload storage. New presentation images require HTTPS. Photos need meaningful alternative descriptions. Stock photography is supplied by the stock feed.
- Credentials for Grok/stock imports, email, payments, domains and authentication remain private deployment configuration. They must never be added to the public dealer-settings response.
- Vehicle facts, availability, insurance-history disclosures, prices and customer records are data, not marketing settings.
- Validation, payment simulation notices, transaction status, security and sales rules remain application-controlled. Layout structure and every incidental system label are not editable in this release.
- Colour choices can reduce readability: review the preview before publishing. Status/WhatsApp colours remain semantic. Not every decorative surface is independently configurable.
- A new dealership still needs its own deployment/database/integration credentials. This work does not clone environments or make the application multi-tenant.

## Storage and compatibility

New optional fields live in the existing `dealer_settings.config` JSON record under `presentation`; no schema migration is required or was run. OpenAPI, client types and Zod validators are regenerated together. Legacy records fall back to existing content. Partial presentation/page-copy updates preserve omitted fields; explicit empty strings clear copy overrides. The settings PATCH remains staff-protected.

No production settings, stock, customer records or deployment were changed.

## Verification

- 188 frontend tests passed; 11 backend settings schema/compatibility tests passed. Complete workspace typechecking and builds passed (existing >500 kB frontend chunk warning remains).
- Four desktop/mobile browser tests passed: guided setup plus customer stock, saved, contact, warranty, test-drive and part-exchange pages.
- Isolated browser tests at 390px and 1280px cover guided navigation, draft preservation, review-before-publish, successful publish, public page/image updates and invalid URL rejection. GET/PATCH settings are intercepted in-memory; tests do not save to the running dealership.
- Desktop visual inspection and desktop/mobile screenshots in `/tmp/onboarding-*-brand.png` and `/tmp/onboarding-*-pages.png`.
