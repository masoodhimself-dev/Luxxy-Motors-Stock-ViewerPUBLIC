# Staff sales process

The local network version and deployed API share the same sales rules. Their sales databases and private settings remain separate. Existing sale files and issued documents are preserved.

## Setup

In Settings → API integrations → Sales paperwork, enter the dealership-approved reservation terms and terms and conditions of sale. No default legal wording is supplied. Changes apply to future agreements only; issued documents retain their original text. Configure this separately locally and on the hosted website.

## Staff steps

1. Open Sales → New sale. Enter the customer (or use a recent enquiry/reservation), choose the car and agreed price. Part exchange is optional; up to three cars are supported. Save progress.
2. If taking a deposit, select **Take deposit & reserve**, record money actually received, its method and date. This atomically records the deposit, reserves the stock vehicle and issues a deposit receipt, reservation agreement and balance statement. A pending payment does not reserve the car or reduce the balance until confirmed using the reservation action.
3. On Payments, add later payments, fees or discounts. Every confirmed payment receives its own numbered receipt. Cash and bank-transfer payments may be recorded separately. Receipts can be selected, printed, downloaded or shared through the existing customer-link features.
4. Select **Complete sale**. If a balance remains, record the final payment first. Review customer, car, total, delivery/collection arrangement and approved terms, then confirm completion. The API requires a zero balance and supplied terms, issues an invoice, terms and vehicle details/disclosures, and marks the car sold so it leaves public stock.
5. On Documents & handover, print the full issued pack or download individual PDFs. Arrange collection/delivery and mark collected/delivered when it actually happens. Completion and handover are separate events.

## Safeguards

- Availability and document/payment changes are atomic; a competing reservation rejects the operation without a receipt or payment being persisted.
- Request IDs and revision checks protect against repeat clicks and concurrent staff edits.
- Completed customer, vehicle and agreed financial details are locked. Issued copies and PDF archives never change with later settings edits.
- Refunds/payment corrections retain the original ledger. A paid reservation cannot be released until confirmed funds have been refunded/corrected.
- Vehicle disclosures use supplied facts and explicitly entered document notes. Missing facts are omitted.
- Legacy sales, receipts, API actions and provider-payment reconciliation remain supported. No existing sale is completed by this update.
