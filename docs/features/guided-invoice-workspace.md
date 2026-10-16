# Guided dealership invoices

The dealer sales workspace asks five questions: vehicle, customer, sale/payment details, invoice type, and review. It does not render a live PDF, offer delivery/handover steps, or generate a separate document pack. Saved historic documents remain available.

## Staff journey

1. Select the car first. Check its number plate and agreed price.
2. Enter the customer, or select a recent enquiry/reservation for that same car. Importing a customer cannot silently replace the selected car.
3. Add any agreed fees, discounts or up to three part exchanges, then record actual payments one at a time with amount, date, method and optional reference. A confirmed deposit reserves the car. Corrections/refunds retain the original entries and update the net balance; they do not move funds.
4. Choose **Deposit invoice** or **Full invoice**. A deposit invoice requires a genuinely received deposit; staff can go back to record one. An unpaid full invoice remains supported.
5. Check the summary and create the invoice. Open/print, download or email its saved PDF. After a full invoice, choose whether to mark the car sold and remove it from public stock. Selling requires a full invoice matching the latest details/payments. If money remains due, staff must explicitly acknowledge it; the balance and acknowledgement remain in the record. Choosing no leaves availability unchanged.

The 13 October regression run passed 116 sales-related tests across UI, calculation rules, invoice settings, PDF output, stock lifecycle, connected store logic and isolated local HTTP workflows. No real customer sale or payment was created by these tests.

## Backend

The new authenticated, tenant-scoped routes are `/api/sale-workspace/:id/invoice-payments`, `/issue-invoice`, and `/finish-invoice-sale`. Shared ledger rules retain decimal-to-pence validation, overpayment protection, optimistic revisions and exact-request replay. Deposit reservation and sale removal are written under the existing dealer transaction/vehicle ownership checks. No new database migration is needed.

Invoices carry `invoiceKind: deposit | full` while retaining the existing `invoice` document type and reference sequence. They freeze the customer, richer car specifications, dealership branding, approved terms if supplied, and all payment entries. Confirmed payments (including negative refunds/corrections) appear individually; pending money never reduces the balance. An unpaid full invoice can be issued. Removing that car requires explicit acknowledgement of the outstanding balance. Later interim/final payments remain recordable on sold sales, and staff can create an updated full invoice.

## Photograph and PDF

The vehicle section has a prominent specification grid and a small photograph when available. Source images use the existing HTTPS host allowlist, validated/pinned public DNS, redirect refusal, size/dimension limits and a four-second deadline. The image bytes are embedded in the saved snapshot/PDF so reprints and emails remain unchanged. Missing photos are omitted. Additional approved CDN hosts use the existing `VEHICLE_PDF_IMAGE_HOSTS` configuration.

Existing document archives are never rewritten. New compact invoices have two settings styles: **Design A - clean stationery** and **Design B - accent stationery**, with white backgrounds, smaller typography, fine rules, a column-based payment history and a narrow statement-style balance summary. B uses the dealership accent for headings and rules rather than background panels. Old Classic/Modern settings map to A for future invoices and Premium maps to B; historic snapshots and saved PDFs keep their original style.

The compact layouts issue exactly one A4 sheet. They measure actual text, long descriptions, payment rows and legal details before archiving. An oversized invoice is rejected with an actionable 422 error, without dropping payments, clipping wording, issuing a document or consuming a reference. Existing long-form historic documents and statements retain their original pagination. Fictional compact design proofs with fourteen payments are in `output/pdf/compact-invoices/`.

## Settings and verification

Settings → Sales documents provides character counters and server-enforced maximums: footer 120, payment instructions 240, sale terms 600, and deposit terms 600. Existing oversized wording is shown intact and must be edited explicitly; nothing is shortened automatically. Character limits are not a guarantee that every combination of content fits, so actual issuance also checks the measured layout. The settings PDF preview updates only after **Check A4 preview** / **Update A4 preview**.

New invoices receive an opaque 256-bit verification capability, generated inside the transaction before their original PDF is archived. The PDF contains a locally generated vector QR code and clickable link on the dealership's canonical origin: `/verify-invoice/:saleId/:documentId/:token`. No external QR service, new provider secret or database migration is required.

`GET /api/invoice-verification/:saleId/:documentId/:token` reads only that tenant's saved sale row and compares the capability hash in constant time. It returns the original invoice reference, dealer, vehicle/registration, issue date, frozen totals and confirmed-payment count. It never returns the customer name, address, phone, email, payment references, full record or PDF. A newer same-kind invoice is identified without changing the original proof. Verification confirms those saved details; it is not a digital signature proving every byte of a presented PDF is unchanged.

The verification page has no showroom navigation or analytics-bearing layout. Page/API responses use no-store, no-referrer and noindex headers; API request logs redact the capability path. The development fixture implements the same proof contract with fictional/test records. Original invoices issued before this change are not retrofitted with QR codes.

Resend still needs the dealer's configured email integration to send documents. The workspace reports prepared/failed/sent outcomes explicitly.
