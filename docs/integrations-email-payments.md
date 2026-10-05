# Email and reservation payments

The owner can prepare Resend and Stripe in **Staff portal → Settings → API integrations**. Both services start disabled. **Settings → Email templates** controls every email subject and message, plus the global logo, brand colour, heading and footer. Changes to email copy never expose provider keys or enter the public dealership settings.

## Private credentials and storage

Resend supports an API key, sender and optional reply-to address. Stripe supports explicitly selected test/live mode, publishable key, secret key and webhook signing secret. Responses report whether a key is configured; they never return its value or a fragment. Blank inputs retain a saved key. The owner can explicitly remove a key. Changing Stripe mode clears all old mode keys and disables payments until the new mode is configured.

Production requires `INTEGRATIONS_ENCRYPTION_KEY`: 32 random bytes encoded as base64 or 64 hex characters. Generate it once outside the application and retain it securely for recovery; replacing it without migrating the encrypted file makes existing settings unreadable. `INTEGRATIONS_PRIVATE_DIR` may point to a persistent private directory outside the frontend/static directory. Its default is `.private/dealer-integrations`; the directory is mode 0700 and files are mode 0600. Production records use authenticated AES-256-GCM encryption. This file store is intended for one API process on one host; multiple replicas need a shared transactional credential store. Back up the encrypted file and retain its encryption key separately.

The local development server keeps its own private settings file under `.local`, with mode 0600, and never contacts providers. Provider keys and email drafts are not saved to browser storage. Private settings endpoints require the `integrations.manage` permission, which belongs to the owner, and reject browser origins outside the configured dealership origin.

`RESEND_ENABLED=true`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL` and optional `RESEND_REPLY_TO_EMAIL` remain an explicit provisioning alternative before the owner saves Resend settings. Editing email templates/branding preserves that configuration. An owner save explicitly takes precedence.

## Email wording and documents

Available templates cover enquiry acknowledgement, dealer notifications, callbacks, booking requests/confirmation/changes/cancellation/reminders, reservation confirmation/payment/refund, invoices, payment receipts, balance statements, other sales documents and private customer access links. Both subject and body accept named variables such as `{{customer_name}}`, `{{dealer_name}}`, `{{reference}}`, `{{vehicle_title}}`, `{{appointment_time}}`, `{{document_number}}` and `{{portal_url}}`. The editor lists the complete permitted variable set. Unknown or malformed variables and multiline subjects are rejected.

Content is plain text with preserved line breaks. Values are escaped, including customer messages, names and vehicle labels. The server independently appends the factual reference, appointment status or financial summary, so editing prose cannot remove those details. The global logo accepts HTTPS URLs without credentials; brand colour, heading and footer are validated. Sample previews use synthetic customer information and send nothing.

Actual delivery uses the configured Resend sender/reply-to and provider idempotency keys. Issued sales receipts/invoices use their immutable PDF archive as attachments. Failed or disabled delivery does not fabricate a sent email or change a payment. Document email/resend actions keep their delivery ledger; reservation emails retain provider status and cumulative refund markers so a full refund can send after an earlier partial refund. A provider acceptance identifier indicates submission to Resend, not proof that the recipient has read the message.

## Stripe checkout and confirmation

The server checks the selected stock vehicle, current advertised price, deposit and accepted reservation terms before creating a temporary hold. Checkout amounts come from this server snapshot. The customer receives a Stripe-hosted URL; no card data passes through the application. Stripe Checkout Sessions use a 31-minute expiry and stable idempotency parameters.

Production accepts live payments only. Test mode can be configured and validated, but cannot enable production checkout. Development test confirmations remain `test_confirmed` with **£0 real money received**, release the temporary hold and create no financial payment or receipt. The local development server never starts a real Stripe request.

Configure the endpoint `/api/reservations/stripe/webhook` in the Stripe dashboard for:

- `checkout.session.completed`
- `checkout.session.expired`
- `checkout.session.async_payment_failed`
- `charge.refunded`
- `refund.created`
- `refund.updated`
- `refund.failed`

The endpoint verifies the signing secret against the original raw bytes with timestamp tolerance. A completed checkout must match the saved session, dealer, reservation, amount, currency and payment mode, and report a paid, completed payment session. Only then does one database transaction create or update the connected sale, confirmed deposit and immutable receipt, and mark the reservation paid. Duplicate events/payment intents cannot create a second deposit. Refund IDs and signed status changes determine confirmed money returned: pending refunds are never booked as successful. A later failed or cancelled refund appends a financial correction and flags the reservation for review. Partial or complete succeeded refunds issue immutable receipts and keep the vehicle held until staff reviews/releases the sale. Older or duplicate events cannot restore an obsolete refund status; incomplete provider refund histories require staff reconciliation.

The payment return page reads status through `POST /api/reservations/payment-status` with the reference and private capability token in the return link. The response omits customer contact details and provider/session/request secrets. Redirecting back from Stripe never itself confirms payment; the page awaits signed webhook confirmation. An early refund event resolves its PaymentIntent metadata read-only and retries until the signed deposit event has committed, so out-of-order webhook delivery cannot silently discard a refund.

The expiry worker checks every minute. A provider-confirmed expired unpaid session releases its abandoned hold. An interrupted create retries the exact saved request with the same provider idempotency key. Definite first-request rejection releases the hold; uncertain, paid, old or account-changed sessions remain protected and flag the staff worklist for review. It never assumes a failed connection means no money was paid.

## Readiness and checks

**Validate saved settings** checks configuration locally: required fields, key prefixes/mode and address formats. It sends no email, creates no checkout and makes no charge. Verify the sender domain in Resend and the webhook endpoint in Stripe before enabling the relevant service. No credentials, external messages or payments were used while implementing or testing this preparation.

Reference: [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email), [Stripe Checkout Session creation](https://docs.stripe.com/api/checkout/sessions/create), [Stripe webhook signature verification](https://docs.stripe.com/webhooks/signature), [Stripe refund status and events](https://docs.stripe.com/refunds).
