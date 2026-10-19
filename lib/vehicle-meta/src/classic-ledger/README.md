# Classic ledger invoice presentation

Adapted from the approved `dealership-invoice-classic-ledger-production.zip` (Direction 01, October 2026). Code licence: `LICENCE-CODE.txt`; body font licence: `FONT-LICENCE.txt`. The registration font and its OGL attribution remain in the shared registration-plate files.

`render-invoice.ts` measures and draws A4 stationery using jsPDF. It accepts already-formatted amounts and ordered confirmed payment rows. The host adapter in `../compact-invoice-pdf.ts` maps the immutable, customer-safe document snapshot. It performs no new ledger calculation, numbering, issuance, storage or network activity.

Host adaptations:

- Reuse the existing `qrcode-generator` dependency and strict verification-URL contract.
- Embed the approved DejaVu Sans body fonts and existing Forecourt Plate UK font. The PDF renderer is loaded dynamically by the staff preview; website typography is unaffected.
- Preserve every supplied vehicle fact, customer contact, collection date, signed refund/reversal, pending-payment notice, customer-credit label, footer and terms.
- Keep a table heading with its first measured row. Grow monetary columns for large supported values instead of splitting digits or shrinking payment text.
- Retain original photo proportions, all payments and four-module QR quiet zones. Longer content continues on A4 pages with repeated identification and payment headings.
- Preserve logo visibility/size, brand colour and ink-saving controls. Ink-saving changes vector colours; embedded colour photographs remain colour, matching the existing setting's behaviour.
- Use deterministic snapshot timestamps and PDF file identifiers for preview/issue consistency.

Only invoice snapshots marked `invoiceSettings.layoutVersion = 'classic-ledger-v1'` use this renderer. Future settings factories add the marker; historic snapshot sanitization never adds it. Stored issued archives are not regenerated. An older record without an archive still uses its original renderer. The legacy compact renderer is retained byte-for-byte in `../legacy-compact-invoice-pdf.ts`.

The supplied fictional logos/photos, review page, sample data, development scripts and separate npm dependency tree are not imported into production.
