# Guided dealership invoices

The dealer sales workspace asks four questions: invoice type, customer and vehicle, payments received, and review. It does not render a live PDF, offer delivery/handover steps, or generate a separate document pack. Saved historic documents remain available.

## Staff journey

1. Choose **Deposit invoice** or **Full invoice**.
2. Import a recent enquiry/reservation or enter the buyer. Select a stock car and check its registration and agreed price. Fees, discounts and up to three part exchanges are optional.
3. Record actual payments one at a time, with amount, date, method and optional reference. A confirmed deposit reserves the car. Corrections/refunds retain the original entries and update the net balance; they do not move funds.
4. Check the summary and create the invoice. Open/print, download or email its saved PDF. After a full invoice, choose whether to mark the car sold and remove it from public stock. Selling requires a settled balance and a full invoice matching the latest details/payments. Choosing no leaves availability unchanged.

## Backend

The new authenticated, tenant-scoped routes are `/api/sale-workspace/:id/invoice-payments`, `/issue-invoice`, and `/finish-invoice-sale`. Shared ledger rules retain decimal-to-pence validation, overpayment protection, optimistic revisions and exact-request replay. Deposit reservation and sale removal are written under the existing dealer transaction/vehicle ownership checks. No new database migration is needed.

Invoices carry `invoiceKind: deposit | full` while retaining the existing `invoice` document type and reference sequence. They freeze the customer, richer car specifications, dealership branding, approved terms if supplied, and all payment entries. Confirmed payments (including negative refunds/corrections) appear individually; pending money never reduces the balance. An unpaid full invoice can be issued but cannot mark the car sold.

## Photograph and PDF

The vehicle section has a prominent specification grid and a small photograph when available. Source images use the existing HTTPS host allowlist, validated/pinned public DNS, redirect refusal, size/dimension limits and a four-second deadline. The image bytes are embedded in the saved snapshot/PDF so reprints and emails remain unchanged. Missing photos are omitted. Additional approved CDN hosts use the existing `VEHICLE_PDF_IMAGE_HOSTS` configuration.

Existing document archives are never rewritten. Ordinary invoices fit one A4 page; long terms, many payments or unusually long supplied text continue to additional A4 pages rather than losing information. Fictional design samples are in `output/pdf/guided-invoices/`.

Resend still needs the dealer's configured email integration to send documents. The workspace reports prepared/failed/sent outcomes explicitly.
