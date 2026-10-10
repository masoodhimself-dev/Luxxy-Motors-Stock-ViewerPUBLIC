# Invoice-first sales workspace

The local portal Sales section now shows the editing form beside a live draft invoice on desktop. At 1100px and below, Edit sale / Invoice preview switches between them without losing edits. The preview reads current draft values; it never modifies an issued snapshot.

Staff workflow:
1. Select New sale, enter or import the customer, choose the vehicle and agree its price.
2. Review the live invoice. Add part exchange if needed, agreed invoice notes, and fees/discounts in Payments.
3. Save draft. This saves details without issuing a document or reserving/selling stock.
4. Deposit & receipt records an actually received deposit using the existing confirmation and approved terms checks, reserves the car and issues its receipt/agreement. Later confirmed payments each have their own receipt.
5. Complete sale uses the existing balance and terms checks, issues its invoice and supporting pack, and marks the car sold so it leaves public stock.
6. Receipts & documents reopens saved copies. Edit sale details returns to the editor; issuing another invoice preserves earlier versions. Printing alone does not issue a document or change stock.

The shared HTML document styling now uses stronger headings, dealer accent, clearer sections and a prominent balance. Newly archived A4 PDFs use the saved dealer name and accent, aligned amounts and page references. Existing archived PDFs remain unchanged. The PDF archive renderer uses text branding, while the browser print layout supports the configured logo. Long invoices/terms can continue over multiple A4 pages to retain the full contents.

Verification: both TypeScript projects, frontend unit suite (317 tests), responsive checks at 390/820/1440, immutable receipt/stock lifecycle tests, isolated HTTP revision/idempotency checks, deterministic PDF test, and rendered PDF inspection. Browser tests use fictional data and block real writes.

These changes are local; no Render deployment or database migration was performed.

## Colour refinement

Document colours derive from the dealer branding captured with the document. Richer headings and table bands, pale customer/vehicle panels, alternating row shading and a tinted total summary establish the hierarchy. The dark brand tone is adjusted to maintain at least 4.5:1 contrast with white text even for pale/yellow dealer colours. An issued zero balance gets a green balance panel; outstanding balances and credits retain their explicit text labels. Drafts never acquire the issued green settlement style.

The archive renderer shares the palette calculation. It continues to use immutable snapshots, and previously archived files are not regenerated. Colour and grayscale A4 examples were visually checked. Eight browser tests, 23 document/palette unit checks and the deterministic archive PDF test passed, with frontend/backend TypeScript checks also passing.

## Dealer invoice settings and reference sequences

Settings → Sales documents now offers Classic, Modern and Premium styling, website or independent invoice colour, logo visibility/size, an ink-saving layout, optional payment instructions and footer wording. The design preview uses fictional customer/vehicle data and does not issue or save a sale. Identity/contact/legal details and the logo come from the dealership Website settings; email templates remain in their existing settings category.

Settings are persisted in private per-dealer sales paperwork, with the existing revision check. Legacy terms-only updates preserve saved design settings. Newly issued snapshots capture these options with branding; existing issued documents and archived PDF bytes remain unchanged. Browser documents use the logo, while the deterministic archive PDF continues to use text branding (no remote asset fetch).

References support a 0–12 character uppercase alphanumeric dealer prefix and a starting-sequence floor (1–999999999). For example `LUX-INV-2026-00120`, `LUX-RCP-2026-00120` and `LUX-SALE-2026-00120`. Fixed document-type identifiers cannot be edited, avoiding cross-type collisions. The established per-dealer/type/year counter is retained: allocation is `max(previous + 1, configured floor)`, padded to at least five digits. Prefix changes and lowering the floor do not reset a counter. The year remains part of the reference and sequences start afresh each year under the existing policy. The settings example illustrates the format/minimum, not the next actual allocated number. Failed mutations and retries retain the existing transactional/idempotency protections. Staff changes, local preview, verified Stripe payments and refunds use the same allocator.

Validation: isolated backend settings/reference tests, existing sales/domain/PDF/HTTP checks and responsive settings/live-editor browser tests. UI saves in browser tests are intercepted; no real sales, settings, payments or emails are modified. No migration or Render deployment is included.

## Classic receipt book

In Documents & handover, select an issued receipt, then choose **Classic receipt book** in **Print style**. Print / Save PDF uses cream stationery with blue handwritten-style values, the original payment/reference/balance and the receipt's saved dealership branding. A tilted car-details note uses only available year, fuel, transmission, mileage and colour from the issued snapshot. It is omitted when these facts are missing. Refunds/reversals/corrections are labelled separately; changing style never issues documents or records payments.

**Blank receipt - fill in by hand** prints current dealership branding and unfilled lines, without copying any customer/payment/reference. It is stationery, not an issued receipt, and manual payments must still be recorded in the system. Email, archive download and full-pack printing continue to use the standard saved documents. Local-only; no backend changes or deployment. Handwritten fonts use platform fonts with readable fallbacks.

Checks: 18 document unit tests, existing five invoice browser checks and three classic receipt checks at 390/820/1440px; standard and classic normal receipts print on one A4 page. Every browser-test API write was blocked. Long real details can flow onto additional pages rather than being clipped.
