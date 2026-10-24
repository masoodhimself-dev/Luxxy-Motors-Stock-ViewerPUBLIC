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

Final deployment and live verification will be recorded after the follow-up correction is live. Physical iPhone/iPad hardware and actual customer message delivery are not claimed as verified.
