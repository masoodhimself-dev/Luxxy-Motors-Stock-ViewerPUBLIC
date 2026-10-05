# Reserve car online

The website now creates a persisted reservation, not a demonstration receipt. Only payment is simulated. This replaces the earlier `Leave a deposit · demo` interaction.

## Dealer settings

Staff portal → Settings → Services → Reserve car online controls the feature, the deposit amount (£1–£10,000) and the reservation terms. Enabling it requires terms. Existing deployments default to disabled. The local preview starts enabled with clearly labelled sample terms. Older settings clients preserve the stored reservation settings.

Disabling removes customer actions and rejects new requests at the server. Existing reservations remain available to staff and can be cancelled. Simulated reservations remain until staff releases or processes them. Production Stripe checkout uses temporary holds with provider-confirmed expiry, described in [Email and reservation payments](integrations-email-payments.md).

## Customer and staff flow

Customers select a stock vehicle, enter name/email/phone, review the server-checked price/deposit/terms, accept the terms, and confirm the reservation with simulated payment. Existing contact and part-exchange details are reused when opening from an enquiry. Booking a viewing or sending the enquiry remains a separate action.

A successful request marks the stock vehicle reserved, creates a reserved website lead, and stores a reservation reference, accepted terms, expected deposit and simulated-payment metadata in the existing append-only lead-event history. It records **£0 received**. No offline deposit, payment ledger or sale is fabricated. Reserved stock remains visible with a Reserved badge and cannot be reserved again online.

Staff portal → Reservations lists customer/car/reference and payment status. Staff can open the lead or deliberately cancel the reservation. Cancellation retains the record and returns the car to available only when no conflicting sale, paid deposit, competing reservation or changed vehicle/lead state exists.

## API and payment boundary

- `POST /api/reservations`: public, validated and rate limited; requires a selected available vehicle and a UUID idempotency key. The server checks current dealer settings, vehicle price, deposit and terms before writing. Repeated identical requests return the original record; a different request using the key conflicts.
- `GET /api/reservations`: staff only.
- `POST /api/reservations/:id/cancel`: staff only; idempotent cancellation with an audit entry.

The backend uses one database transaction and the same vehicle advisory lock used by sales, plus row locks. Customer input cannot declare a payment paid or choose the charged amount. No schema change or migration is required: existing settings JSON, stock, leads and lead-event tables are used.

Development API mode requires `RESERVATION_PAYMENT_MODE=simulated`. Missing/unsupported payment modes and `NODE_ENV=production` reject simulation requests. Switching the settings toggle on does not bypass this guard. The separate Stripe checkout adapter is prepared through private owner-only integration settings and starts disabled.

The prepared Stripe flow now supplies server-created Checkout amounts, signed idempotent webhook handling, temporary-hold recovery/expiry, cumulative refunds, a connected deposit receipt and customisable Resend confirmation emails. Only verified live provider events mark real money received. See [Email and reservation payments](integrations-email-payments.md) for setup, private payment-status links and reconciliation behaviour. Existing simulated reservations continue to show £0 received.

## Local preview

The preview uses the same pure reservation policy with local fixture stock and an atomic JSON repository at `.local/online-reservations-preview.json` (gitignored, mode 0600). It survives preview restarts. Settings and reservation changes are local only; no production database, payment provider, email or WhatsApp is contacted. Loopback host/address and same-origin checks protect this preview-only writable fixture. Its synthetic staff access is not production authentication.

The production API implementation uses the real database transaction; the preview repository is never imported into the production entry point. Other preview enquiry/booking writes remain disabled unless intercepted by browser tests.

## Verification

177 frontend tests, 16 reservation-policy tests, 8 PostgreSQL integration tests, 6 settings tests, 2 database-safety tests and 14 distinct browser checks passed. Workspace typechecking and builds passed. PostgreSQL tests used the existing disposable `luxxy_test_milestone1` database on `127.0.0.1:55439`, with suite-specific dealer fixtures and no migration. The test database was shut down afterwards.

Commands: `pnpm --filter @workspace/api-server test:reservations`, `test:reservations:integration`, `test:settings`, `test:safety`; frontend `test`; browser specs `reserve-car`, `reservation-settings`, `staff-reservations`, `enquiry-inline-exchange`, `stock-photo-viewing`; `PORT=4175 BASE_PATH=/ pnpm build`.
