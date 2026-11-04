# Vehicle returns

A physical return is recorded against its original completed sale. It does not delete an invoice, create a fictional receipt or initiate a refund.

## Return only

`POST /api/sale-operations/:id/return-car` requires `sales.manage` and `payments.refund`, the saved revision and a unique retry identity. It locks the dealer, sale and vehicle, verifies that the sold vehicle still belongs to this sale, records the agreed credit and places the stock on a hidden inspection hold. Existing PDFs and actual payment entries remain unchanged. Open payment requests are cancelled and unfinished driver jobs are revoked.

`agreedCredit` credits the original agreed charges, including unpaid charges. For a £10,000 agreement with £2,000 received, a £10,000 return credit cancels £8,000 unpaid and leaves £2,000 refundable. No final payment is invented. The credit cannot exceed the original agreed total and must clear its unpaid balance; other disputed agreements require a manager. Pending entries, part-exchange property and provider-managed settlements must be resolved first. Staff confirm actual receipt of the car, the agreed credit and finance/third-party settlement, and record return date, mileage, reason and condition.

The sale stores `standaloneReturn`, retaining the original completed date and documents. A `return-only-credit` document shows original charges, unpaid balance cancelled and refund due at return. It never claims credit went to a replacement or that money was sent.

## Refund held credit

The shared pure `refundSaleCredit` operation records an actual refund only after staff confirm it was paid. It supports held return-only or replacement credit, bounds each refund by the current negative balance, validates method/date, appends a negative confirmed ledger entry and issues a refund receipt. Revision locks and request fingerprints make an uncertain exact retry safe. Ordinary payment reversals on a returned sale are blocked to avoid duplicating the credit refund. The portal never initiates the bank/card movement.

## Return and replace

`return-replace` rechecks both cars and the credit under the existing transaction locks. Its UI shows the exact replacement price, transferred credit and difference; no broad AI review or override is required. The original must be completed and settled, with no pending/provider-managed funds or part-exchange property. It preserves one credit movement and all historical documents. Higher/equal/lower replacements and subsequent replacement chains remain supported.

## Re-advertising

Both return paths hold the original car off sale. The separate inspection action verifies the hidden hold, source listing and competing ownership before making it available. It can restore only the exact trusted prior sold-retention archive; a missing source, manual archive or competing sale needs review. Inspection does not change a refund balance or the original paperwork. Evidence remains attached to its original sale and vehicle.

## Verification

From `artifacts/api-server`: `node test-sale-return-only-build.mjs`, then `node --test .cache/sale-returns/sale-return-only.test.mjs .cache/sale-returns/sale-return-inspection.test.mjs`.

Frontend coverage: `sale-return-car.test.tsx`, `sale-return-replace.test.tsx`, `sale-return-inspection.test.tsx`.
