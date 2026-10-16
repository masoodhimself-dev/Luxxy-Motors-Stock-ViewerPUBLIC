# Typography and settings review — 13 October 2026

The customer site, portal, platform console, chat, enquiry workspace and invoice builder now use the same `--app-font-sans` token backed by locally hosted Inter. Form controls inherit their surface's font; mobile text inputs use 16px. Numeric codes, number plates and the deliberate classic document styles remain distinct. Issued PDFs and email-client font fallbacks are unchanged.

The dealer Settings hub now has a desktop category rail and phone category selector. Website settings use a compact section chooser above the editor, with consistent labels, hints, rounded cards and controls. Email, integration and document editors share the same surfaces and spacing. Corrected integration CSS previously used bare HSL triplets as colours, which browsers could discard.

The existing save endpoints, permission checks, settings revisions, publishing review and browser-tab draft recovery remain in place. Switching categories now warns before discarding unsaved email wording/branding, private connection settings or sales paperwork. No credentials are placed in browser storage. No live business settings were published during this audit.

Verification:

- 68 focused frontend tests passed across settings, integration keys, email previews/saves, paperwork, navigation/permissions, stock and vehicle pages.
- New tests cover website changes surviving section switching, review before publish, blocked invalid name, desktop/mobile category selection and declining an unsaved-changes warning.
- Typechecking and production build passed. Existing Vite source-map/chunk-size warnings remain.
- Browser inspection of local settings at 1280px, 820px and 390px. Fixed a phone section-navigation overflow, a sticky phone save bar and a clipped tablet category label. Final measured page widths equal the respective viewport widths.
- Browser font inspection confirms Inter is loaded and shared by customer and portal headings/body.

Limits: these are local browser and simulated-width checks, not physical-device Safari tests. Live Clerk-protected editing has not been exercised with a signed-in production staff account. Mocked tests do not send email, create payments or alter issued documents.
