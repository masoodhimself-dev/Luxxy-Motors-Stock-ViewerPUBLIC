# Shared sale files, receipts and handover

The Sales section keeps one sale file for a customer and vehicle. Customer details, agreed charges, up to three part exchanges, payments, documents and handover arrangements stay together. The staff portal retains its existing access boundary.

## Staff workflow

1. Start **New sale**, or reopen a sale by customer, telephone, registration or reference.
2. Add the customer, vehicle and agreed price. Contact details can be copied from a recent enquiry or reservation; reservation payments are not automatically credited.
3. Use **Record payment** whenever money is paid. Each confirmed deposit, part payment or final payment creates its own numbered receipt. **Money received** must be explicitly checked.
4. Keep expected money as a pending payment. It does not reduce the balance and cannot produce a receipt. Later, **Confirm received** records the actual received date and issues the receipt. A cancelled pending entry stays in the history.
5. Open **Receipts & documents** at any point to issue an invoice or balance statement, or reprint a saved document.
6. Choose collection or delivery independently of whether the customer viewed the car. Schedule the date, time window and recipient; delivery also records an address and instructions. Add an agreed delivery charge once under fees and discounts.
7. Use **Mark collected** or **Mark delivered** after the vehicle changes hands. A remaining balance requires an explicit acknowledgement. Handover completion does not mark the sale paid.

## Money and document rules

- Amounts are calculated in integer pence. Only confirmed payments affect the paid total; refunds and staff reversals have negative signed amounts. A signed provider refund failure adds a positive correction restoring the original funds.
- The sale total includes agreed fees and discounts, then deducts part-exchange allowances. Staff cannot record payments beyond the resulting balance. Provider refund corrections can restore a customer credit, which stays visible until reconciled.
- A final payment must settle the current balance. Smaller amounts are part payments.
- Each issued receipt stores the individual payment, cumulative confirmed payments and balance at issue. A later payment never rewrites that receipt.
- Issued documents contain saved customer, vehicle and dealer-branding data. Earlier invoice versions remain available when agreed details change; a current balance statement shows the latest ledger.
- Documents are rendered and printed from stored snapshots. New issued documents also retain a deterministic PDF archive; older snapshots can export a PDF without rewriting their history.
- **Refund / correct** retains the original payment and receipt and adds a separate linked entry, reason and document. Recording a refund does not send money to the customer.
- Repeated requests reuse an idempotency reference. A lost response can be retried without generating another payment or document number.
- Every update supplies the last known revision. Stale changes are rejected and the editor keeps unsaved fields until staff choose **Reload latest sale**.
- Completed handover evidence cannot be changed through an ordinary sale-details update.
- A sale can continue after its vehicle leaves the stock feed. Later documents reuse saved facts only when they belong to that same vehicle; a different selected vehicle never inherits those facts.
- Existing browser-local draft payments and simulated reservations are never silently promoted into confirmed money.

## Storage and deployment

The local preview saves shared files in `.local/sales-workspace-preview.json` on the server, using serial writes and atomic file replacement. Mac, iPad and phone browsers connected to that preview use the same records. The sandbox is restricted to loopback or the explicitly configured private LAN host and same-origin requests.

The production API uses a separate PostgreSQL sale workspace and numbering table, dealer-scoped queries, transactions and revision checks. Settings and vehicle facts are read on the already-held transaction connection, so competing staff saves cannot exhaust the connection pool while waiting for the dealer lock. Apply `lib/db/drizzle/0016_sale_workspace.sql` through the deployment's migration process before using shared sales there. This implementation does not re-enable the retired `/api/sales` process or run a production migration.

Staff payment recording does not charge cards. Stripe checkout and Resend email use separately configured private API settings and remain disabled until the owner enables them. Signed provider payment events use this same ledger and document workflow; the local preview never sends email or charges cards.

## Verification

`artifacts/luxxy-motors/tests/sales-lifecycle.spec.ts` intercepts every sale request and uses the real shared reducer against isolated memory. It blocks all other dealership API writes. Its 13 browser cases cover:

- Deposit, part payment and final payment with mixed methods and an unchanged printable original receipt.
- Pending confirmation and cancellation.
- A sale reopened in a second browser context and rejection of stale edits.
- Plain-HTTP LAN request identifiers when `crypto.randomUUID` is unavailable.
- Partial refunds, full corrections, preserved receipts and reasons.
- Safe retry after a payment commits but its response is lost.
- Amended invoice versions and the latest balance statement.
- Simulated reservation import without a credited deposit.
- Delivery with and without a prior viewing.
- Collection with an explicitly acknowledged unpaid balance.
- Phone and tablet forms without horizontal overflow at 390 and 820 pixels.

The 13 browser cases passed against the local preview on 4 October 2026. `pnpm --filter @workspace/api-server test:sale-workspace` also runs 11 shared-reducer tests, one PostgreSQL store test with an isolated single-connection fake pool, two durable preview-store tests and one real HTTP test using a temporary store. The HTTP test verifies creation, deposit, reopening, final payment, unchanged original receipt, safe retry, stale-save rejection and cross-origin rejection. The pool test checks that concurrent saves finish without a second connection and reject the stale write. These tests do not write to the dealership's preview records. Production PostgreSQL deployment checks remain part of migration and release verification.

## Connected sales and private customer pages

Start sale from an enquiry or reservation retains its UUID in `draft.sourceEnquiryId` or `draft.sourceReservationId`. Existing sale files are reopened when their source is selected again. Initial source IDs are dealer-scoped and checked against the vehicle by the production store; later edits cannot replace them. Recording payments still does not charge a card. Verified Stripe events alone call the confirmed deposit/refund bridge and issue the immutable receipt in the caller's database transaction.

Stripe refunds count only amounts the provider confirms as succeeded. If a later signed event changes a refund to failed or cancelled, a positive `refund-correction` entry restores that deposit amount with a new receipt and explanation. Original payments, refunds and receipts remain unchanged. Event identities, including events with no financial change, prevent repeated deliveries from applying old totals. Restored funds may create a customer credit if further payments have already been received; the ledger and documents show that credit accurately. Staff sale mutation endpoints cannot issue provider corrections.

Reserve/sold commands and completing handover take the existing `sale-vehicle` advisory lock and the vehicle row lock. They reject competing sale files/reservations and change only dealer inventory status and sales audit metadata, preserving imported source status and pricing. Reserved/sold sale files cannot silently switch vehicle. Sold files cannot be released.

Staff can create a 30-day `/my-purchase/:token` link, replace it or revoke it. The browser generates a cryptographically random 256-bit token; durable storage contains only SHA-256, expiry and revocation. The full link is shown only on creation. Changing buyer identity or the vehicle revokes access. The public endpoint uses explicit whitelists and cannot serialize staff notes, request retries, token hashes, provider payment mappings or PDF blobs. Documents are selected within the authenticated sale and must still match its buyer identity. Issued monetary/customer/vehicle values stay unchanged; staff attribution and staff notes are redacted from customer copies. The linked appointment is refreshed from the enquiry in production.

Each newly issued document receives a deterministic server PDF archive and SHA-256 checksum. The PDF uses its issued branding, vehicle and ledger snapshot without remote images or current settings. Earlier documents without an archive can still export the same deterministic snapshot; no historic JSON snapshot is rewritten. Download, email attachment and customer download all use this archive. Resend document delivery records prepared/sending/sent/failed states and supports a new explicit resend request. Disabled/unconfigured delivery leaves the document prepared until the owner configures API settings. Preview never sends email.

No live migrations, emails, card charges or production record changes are performed when preparing this code.
