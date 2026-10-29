# Portal and stock release — 29 October 2026

Base live commit: `0567a4172ad5b5ed8039dbda6946b39531adc425`.

## Included changes

- Customer stock filters stay on the left on wide screens; phones/tablets use the compact filter drawer. Results begin higher on the page. Applying filters reveals/focuses results after the modal focus trap closes; dismissing returns focus to Filters.
- Staff Cars and the sale vehicle chooser provide richer stock context, customer interest and explicit enquiry/booking/sale handoffs.
- The connected customer workspace preserves selected/merged enquiry identity, drafts and manual email/WhatsApp confirmation rules. Open activity timelines refresh after manual sends, delivery-status refreshes and incoming enquiry revisions.
- Ordinary enquiry deletion uses explicit permanent confirmation and an expected revision. No PIN, default credential or extra Settings section. The API independently rechecks permissions, origin, dealership consistency, sales/financial references, provider history, active bookings, signed declarations and in-flight work under locks. Customer records, invoices, payments and numbering are protected by this ordinary portal action.
- Official Cazoo CSV/SFTP collection is read-only and dealership-bound. Migration `0075` adds private collection candidates/checkpoints. No stock importer or automatic stock apply is included. The saved collector configuration starts collection in its configured London windows; stock import acceptance and Grok delivery remain unchanged.
- Operator-only fresh-start preflight scripts count and fingerprint existing activity in a read-only repeatable-read transaction. They have no deletion mode and are not exposed as HTTP endpoints.

## Verification

- Full frontend suite: 180 files / 1,740 tests passed with Node 24, one worker.
- Later timeline refresh regressions: 39 tests passed.
- Later stock focus/home regressions: 52 tests passed.
- Isolated Cazoo parser/reconciliation/SFTP/collector/database suites: 99 tests passed.
- Enquiry deletion: 16 new protection tests plus 15 existing regression tests passed. Empty sale draft deletion was also checked in the safe-deletion script.
- WebKit responsive journeys: 5 deletion, 15 connected customer workspace, 15 Cars and 17 stock journeys passed. Four additional stock edge-state project combinations are intentionally skipped because those states are covered at representative 320/820/1440 widths.
- Production typechecking/build passed. Browser tests use intercepted local fixtures, not real customer writes or messages. Physical iPhone/iPad hardware has not been certified.

## Separate all-dealership cleanup

The live read-only inspection found 42 enquiries and 25 sale workspaces, containing 28 invoice documents and 52 payment entries, plus one future booking. The user confirmed all existing activity is test data and requested preparation of a complete cleanup. This deletion is separate from the release and migration. Exact manifest, durable recovery copy and final action confirmation are required before applying it. Preserve stock/settings/access/customer master records and invoice counters. This report does not claim that cleanup has already occurred.

## Follow-up limitation

An unchanged Cazoo file can point to its previous saved diagnostic reconciliation. Any future stock-apply implementation must freshly reconcile current inventory/sale state under normal locks; the stored candidate is not authorization to apply stock changes.
