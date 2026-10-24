# Invoice-ready screen and sharing audit

Date: 24 October 2026. Branch: `codex/invoice-ready-fixes`.

## Findings and fixes

1. **Delivery cards accumulated after full-invoice updates.** Confirmed on the live Luxxy invoice shown in the user's screenshot (read-only inspection). A local regression reproduced three delivery cards after reopening/emailing the full invoice. Handover and review-reminder siblings reused the sale ID as their React key. Namespaced component keys now preserve their separate identities. Deposit/full regressions repeatedly open, email and reopen the invoice and assert exactly one collection/delivery region and no duplicate-key warnings.
2. **Disabled WhatsApp controls gave no useful touchscreen explanation.** The shared control now distinguishes loading, a failed settings check and explicit dealer disabling. Failed checks offer a retry. The saved dealer setting remains authoritative; it is never enabled automatically. Luxxy's live setting was confirmed enabled during this audit. The exact cause of the screenshot's original transient disabled state is unconfirmed; corrupted duplicate DOM and settings loading/failure can both leave misleading controls.
3. **Merged customer enquiries broke known-customer preparation.** Exact-ID lookups now follow a bounded, dealership-scoped merge chain. Email and WhatsApp use the canonical customer thread. Missing/cross-dealer links reveal no customer; cycles fail safely. Existing invoice recipient details remain intact and differing WhatsApp numbers still require acknowledgement.
4. **Known-customer lookup was unnecessarily delayed.** Exact-ID requests now start immediately; free-text search retains its debounce. This also removed a QR readiness timing failure under a loaded combined test run without increasing test timeouts.
5. **Merged cases could attribute an invoice message to the wrong car.** WhatsApp confirmation now uses the authorised sharing pack's dealership-validated vehicle for event metadata, while retaining the canonical customer thread. An untrusted raw request vehicle cannot override the pack. Foreign-dealership grants/vehicles remain blocked.

No payment, pricing, sale-completion, collection/delivery-stage or automatic-sending rule was changed. Issued documents and their snapshots remain unchanged. No migration is required.

## Verification

- Full frontend suite: all 1,903 tests passed across 184 files (no retries).
- 102 focused frontend tests passed across invoice-ready/sales, handover, shared QR, WhatsApp confirmation, internal email and review reminders.
- 38 backend media-sharing tests passed, including immutable invoice PDF access, expiry/revocation/replay, manual confirmation history, recipient prefilling, role/dealer boundaries and merged-thread/vehicle regressions.
- 12 browser checks passed at 390, 834 and 1440 px: deposit and full invoices, byte-identical frozen PDF download, native print-window opening, explicit email clicks, invoice QR with prefilled UK number and attachment URL, explicit sent confirmation, delivery messages excluding private notes, delivery state flow/Home tasks and unchanged financial snapshots. These use fictional intercepted API responses only.
- A further phone capture rerun passed after returning the invoice pane to the top for review.
- Workspace typechecking and production build passed. The API build/typecheck were repeated after the final backend metadata fix.
- Diff whitespace checks passed.

## Safety and limits

Live inspection only opened existing sale and settings views. It did not send email, open WhatsApp to send, edit delivery arrangements, save a sale, change a payment or mark a car sold. All email/confirmation mutations in automated tests were intercepted fictional responses. QR handoff and the saved-history contract were tested; no actual WhatsApp delivery is claimed.

Phone/tablet checks use Chrome viewport sizes, not physical iPhone/iPad hardware or an actual printer. The fixes are local and have not been deployed to Render.

Evidence: `/tmp/invoice-ready-keys-before.log` (failing reproduction), `/tmp/invoice-ready-regressions.log` (initial combined run), `/tmp/invoice-ready-build.log`, `/tmp/invoice-ready-api-build.log`, `/tmp/invoice-ready-full-frontend.log`.

Screenshots: `/tmp/luxxy-invoice-ready-full-390.png`, `/tmp/luxxy-invoice-ready-full-834.png`, `/tmp/luxxy-invoice-ready-full-1440.png` and matching deposit captures. These contain fictional test data; status text saying emailed is simulated.
