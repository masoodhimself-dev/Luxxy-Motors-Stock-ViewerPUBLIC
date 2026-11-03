# Full dealership terms

Full terms live separately from the short sale/deposit summaries on an invoice. The existing 600-character summary limits and all historical invoice snapshots remain unchanged.

- `dealer_sales_terms` holds the current review draft and revision.
- `dealer_sales_terms_versions` holds append-only published wording.
- `sale_terms_documents` freezes the applicable sections, version, sale revision, buyer, vehicle, dealer branding and two actual PDF archives (dealer copy; dealer and customer copies).
- Migration: `0082_sales_terms`. Register after `0081_delivery_evidence` in the migration journal.

Shore Drive's supplied wording is available only for `shore-drive-limited` and is initially an unsaved review draft. Reading it performs no write. Every other dealership starts with an empty full-terms draft. Saving a draft does not put it into use. The explicit **Use on new sales** action creates the next published version. Existing documents always download their stored PDF bytes, even after a new version is published.

Source paragraphs are retained verbatim. Category S sections are tagged separately and appear only when the selected stock vehicle has an explicit confirmed `S`/`CAT S`/`Category S` category field; advert text is never used to infer that category. The draft flags the supplied 70% wording, condition/liability clauses and 15-month warranty for review. These are review prompts, not automated legal approval or automatic edits. Configured warranty duration conflicts are also shown when present.

## Integration

Mount `routes/sales-terms.ts` on the API route collection. It supplies authenticated private endpoints:

- `GET /sales-terms`: current review draft, published version and review points.
- `PUT /sales-terms`: `{expectedRevision,content}` saves a review draft; requires `settings.publish`.
- `POST /sales-terms/publish`: `{expectedRevision,confirm:true}` uses the saved wording for new sales; requires `settings.publish`.
- `POST /sales-terms/preview`: `{content,category,copies:'dealer'|'both'}` produces an unissued review PDF; requires `settings.publish`.
- `GET /sales-terms/sales/:saleId`: frozen terms documents belonging to this dealer/sale.
- `POST /sales-terms/sales/:saleId`: `{requestId,expectedSaleRevision,termsVersionId}` issues an immutable terms document; requires `sales.manage`.
- `GET /sales-terms/sales/:saleId/:documentId/pdf?copies=dealer|both`: downloads the chosen stored archive.

`FullSalesTermsSettings` sits below the existing short invoice summaries. `SaleTermsDocuments` belongs in the sales Invoices tab; props are `saleId`, `saleRevision`, and `canIssue` (derive from staff permissions).

Any empty-sale deletion guard must reject sales with rows in `sale_terms_documents`. The issue transaction locks the sale row and requires a passed final check for that exact saved revision before snapshotting and cannot change its financial ledger, status, invoice numbering or payment history. A retry with the same request ID returns the same document; a reused request ID with changed input is rejected. The browser keeps its request ID after an uncertain network result.

## Print layout and checks

`@workspace/vehicle-meta/full-sales-terms-pdf` is a presentation-only renderer using the invoice's embedded DejaVu Sans fonts, A4 portrait, 14mm margins, accent rule and restrained ledger typography. A repeated header identifies the dealer, sale, customer, vehicle and terms version. Every page has the copy label and its own copy-relative page count. Each copy ends in customer signature/date lines. No wording is truncated to fit a page. Unsupported font characters fail preparation rather than producing a misleading document.

Coverage:

- Backend: `test-full-sales-terms-build.mjs` and `src/full-sales-terms.test.ts` exercise validation, actual PDF layout events, tenant isolation, drafts/publication/revisions, immutable archive bytes, retry conflicts, Category S filtering and preservation of the original sale state/payment/document data.
- Frontend: `full-sales-terms-settings.test.tsx` covers draft-only saves, explicit publication, conflict retention and archived print links.
- A 4-page fictional Shore Drive both-copy PDF was rendered to PNG and all pages visually reviewed on 3 November 2026. It is a review draft, not live customer paperwork.
