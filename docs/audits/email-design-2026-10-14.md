# Customer email upgrade — 14 October 2026

## Customer experience

The shared renderer now produces a complete responsive HTML document: a centred email-safe table layout, dealership brand heading/logo and accent, a purpose-specific or customised title, readable paragraphs, recorded-detail card, secure booking/customer-page button when available, actual attachment names, and contact/footer links. The plain-text alternative retains the same recorded details and useful action links. Blank facts and empty brand sections are omitted; zero payments remain visible. No stock, ownership, history or payment facts are inferred.

All 22 default templates received warmer, clearer copy. Requested bookings explicitly remain unconfirmed; cancellations omit management buttons; reservation, deposit and refund messages show their recorded status. Existing dealer-saved subject/body/branding overrides remain in place. Future emails get the new layout; previously stored correspondence and issued PDFs are not rewritten.

Sales-document emails now include supplied registration, issue time, receipt amount when recorded, payments at issue and balance at issue from the issued document snapshot. GBP display uses pounds and pence. This changes presentation only, not the payment ledger, calculations, invoice PDFs or sold/reserved state.

## Settings

Settings → Email templates now has a dedicated editor and server-rendered preview, desktop/phone display options, plain-text view, colour presets and an explicit stale-preview notice. Typing does not repeatedly request or flash a preview. Dealers can customise a template's optional `headline` (the title inside the email), subject and message, plus shared logo/accent/brand heading/footer. Blank headline uses the message-family default. Variables retain their existing whitelist and escaping. Branding/template saves remain separate and revision-protected, and unsaved wording is protected when switching templates.

`headline` is optional in the existing private template JSON and PUT/preview contract; old saved records require no migration. Reset removes the override and restores the current default. No API credentials, Resend enablement, tracking settings, incoming mail or database schema changed.

A missing TypeScript suffix on the shared dealer-onboarding export was corrected because it prevented a fresh localhost preview server from loading. The preview remains bound to localhost.

## Verification

- 17 UI tests: email studio, email workspace, settings access/navigation, integrations and sales paperwork.
- 8 renderer tests: all 22 families, responsive structure, escaping, missing/zero facts, secure links, cancellation, contrasting button text, actual attachments, accurate preview states and editable titles.
- 9 private integration/readiness tests, including saved headline overrides.
- 5 portability/transport tests, including plain-text delivery, attachments and provider idempotency using a mock transport.
- 1 isolated database/HTTP email suite: fictional dealer isolation, private attachments, concurrent/identical retries, changed facts and ambiguous provider replies.
- Shared-library, frontend and API TypeScript checks and both production builds passed. Existing frontend large-chunk/sourcemap warnings remain.
- Browser inspected desktop editor at 1440px and phone editor at 390px. The standalone generated email measured 390px document width at a 390px viewport, with no overflow. Custom title was verified in the real preview without saving it.
- Fictional sample HTML and screenshots are in `output/emails/`.

No real emails were sent. Real Gmail, Outlook and Apple Mail inbox rendering has not been exercised; the renderer includes inline styles and Outlook table fallbacks, but actual client differences still need a controlled mailbox check.
