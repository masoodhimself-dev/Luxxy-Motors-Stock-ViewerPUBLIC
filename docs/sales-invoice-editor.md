# Practical sales workspace

Sales is one three-step workspace at /portal?section=sales. It uses the existing dealer-scoped sale API and confirmed-payment ledger; rebuilding the interface does not replace existing records.

## Staff journey

1. **Deal details.** Start New sale, enter the buyer or select a recent enquiry/reservation, choose the car and agree its price. Optional panels hold up to three part-exchange cars, fees/discounts and agreed vehicle disclosures. The invoice preview updates after a short pause in typing, keeping the current page visible until its replacement is rendered.
2. **Payments.** Record each actual payment separately, including cash and bank transfer. “Money received” starts unchecked. Pending entries do not reduce the balance or create receipts. Confirming a deposit uses the reservation operation and stock checks; it reserves the vehicle and creates a receipt and statement. A reservation agreement is included only when approved dealer reservation terms have been supplied; their absence never prevents recording money received. Sale completion still requires approved terms of sale.
3. **Completion.** Review the customer, vehicle, total, received money, remaining balance and terms. The workspace lists missing requirements before completion. Settle the exact balance, add a delivery address if required, and confirm completion. This issues the invoice, terms and vehicle disclosures, marks the car sold and removes it from public stock. Collection or delivery can happen later and gets its own confirmation.

Saving a draft does not reserve or sell a car. Printing a draft does not issue an invoice. A payment, invoice or receipt is never created merely by previewing it.

Existing receipts remain selectable at every step. The document pack lists its saved PDFs; staff can select each document to print, download or email. Balance statements and issuing an invoice before completion live under **Other documents & receipt styles**. Classic/blank receipt stationery is an optional print alternative and does not replace the saved standard PDF.

Completed customer/vehicle/price/allowance fields are locked. Payment refunds/corrections and handover remain available, with their existing audit and revision checks.

## One document renderer

[The shared PDF renderer](../lib/vehicle-meta/src/sale-document-pdf.ts) creates the PDF for both the draft preview and newly issued server archives. The staff preview, settings design example and private customer document view use the PDF rather than a separately styled HTML invoice.

Issued views fetch the original archived PDF from the authenticated sale endpoint (or token-scoped customer endpoint). They never silently regenerate an archive if its fetch fails. Downloaded and emailed documents retain the same saved bytes. Previously issued archives retain their original design and details.

The invoice shows dealer identity/contact details, buyer and vehicle, charges/discounts/part exchange and a clear total/received/balance summary. A receipt leads with **this payment** and its method/date/reference; a statement shows the ledger. Terms and vehicle disclosures use matching headings on supporting A4 pages. Long content flows onto further pages rather than being clipped.

Only supplied facts are printed. No VAT amount, service history, ownership claim or registration is invented. Existing customer-document redaction remains: agreed vehicle disclosures appear in their dedicated sale-pack document, not as private notes on the invoice. No “Issued document” badge appears on customer paperwork.

PDFs use snapshot branding, the dealer colour and invoice settings. Embedded raster logos can be retained; URL-based logos use the dealer wordmark so rendering never fetches a mutable remote asset.

## Display and checks

On desktop, the editor uses the available workspace height with a separate document column. Phone/tablet layouts switch between editing and the document preview without losing edits. Responsive canvases render the actual PDF pages, with a text equivalent for screen readers; native PDF opening remains available for printing.

Meaningful checks cover integer-pence totals, pending payments, receipts, exact-zero completion, immutable archived reprints, deposit/stock lifecycle, concurrent revisions/idempotent retries, full fictional browser journeys and responsive layouts. Production customer data is not used in these browser tests.

The related temporary module withdrawal is documented in [practical-release.md](practical-release.md).
