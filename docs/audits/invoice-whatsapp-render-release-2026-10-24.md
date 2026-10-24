# Invoice and WhatsApp Render release

Date: 24 October 2026. Release branch: `codex/multi-tenant-foundation`.

## Initial release and live check

- Render service `luxxy-shared-staging` (`srv-db4jfhk9v7es73a4qhrg`) deployed `e8aae5130cf1659a198703e42e947afff0dfeff9` as `dep-dbe63a9srm7s73b11i20`, live at 07:47:19 UTC.
- Luxxy and Shore Drive health and database readiness endpoints returned HTTP 200.
- The affected existing Luxxy invoice showed one Collection & delivery panel, including after opening and closing invoice sharing. Invoice WhatsApp preparation produced the correct invoice attachment link and recipient number. No send or sent confirmation was performed.
- The extra live delivery-sharing check found HTTP 400 for a sale without a source enquiry. Its empty optional enquiry ID violated the API's UUID validation. Existing browser fixtures had always supplied an enquiry ID.

## Follow-up correction

`SaleHandover` now passes absent enquiry/vehicle IDs as `undefined`, so JSON omits them. Valid IDs, dealer permissions, backend UUID validation, arrangement revision checks and manual customer selection remain unchanged. Internal email fallback receives the same optional values.

The component regression reproduced the failure before the correction. Browser fixtures now cover walk-in full invoices and enquiry-linked deposits, with the sharing interceptor rejecting malformed optional IDs instead of accepting them.

Verification after correction:

- 60 focused frontend tests passed.
- All 38 isolated media-sharing API tests passed.
- All 12 invoice/delivery browser checks passed at 390, 834 and 1440 px. They cover deposit/full invoices, unchanged frozen PDFs and payment snapshots, manual email and WhatsApp confirmation, delivery messages, and delivery Home tasks. All mutations use fictional intercepted responses.
- Workspace typechecking and production build passed.
- Independent read-only review and `git diff --check` passed.

No schema migration, payment calculation, issued document, automatic sending or service configuration change is included. The browser fixtures initially changed an enquiry ID after invoice issue and correctly triggered the existing stale-invoice protection; moving that fixture setup before issue resolved the test failure without changing application rules. Sandbox localhost binding failures were rerun successfully with the required local-server permission.

## Final deployment and live verification

- Correction commit: `a8bc747faf954ba6fe89665c5b99b7230b5103d1`.
- Render deploy: `dep-dbe726jrjlhs73em0ki0`, live at 08:52:39 UTC (09:52:39 UK).
- Luxxy and Shore Drive `/api/healthz` and `/api/readyz` all returned HTTP 200 with the expected `ok`/`ready` status.
- Reopened the original Luxxy invoice after refreshing. It retains exactly one Collection & delivery panel after opening/closing both sharing flows. Its invoice number, delivery booking and saved financial summary remain unchanged.
- Invoice WhatsApp QR preparation is ready with the invoice recipient normalized to the UK international format, the correct PDF filename and a temporary private document link.
- Delivery WhatsApp preparation now succeeds for the original walk-in sale. Staff must choose the existing customer enquiry or the explicit new-enquiry option before its QR appears. Selecting the latter in the modal produced the correct prefilled customer number and delivery wording; no enquiry was created because sent confirmation was not pressed.
- The delivery share's email fallback opens the internal Prepare customer email dialog with the reviewed wording/contact details. The dialog was closed without continuing or sending.
- Recent Render error/fatal log query returned no entries after the final release.
- Live proof: `/tmp/luxxy-invoice-render-release-2026-10-24.png`.

No actual email or WhatsApp message was sent; no sent confirmation, sale save/completion, delivery update or payment write was performed. Private sharing links were prepared only and retain their normal expiry. Physical iPhone/iPad hardware and actual customer message delivery are not claimed as verified. Browser runs cover the viewport sizes above.
