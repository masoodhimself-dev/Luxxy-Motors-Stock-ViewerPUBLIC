# Customer email replies

Implemented 23 October 2026. Marketplace lead-email importing remains paused.

## Behaviour

New staff enquiry emails, customer enquiry confirmations and appointment reminders receive a unique random Reply-To address. Routes belong to an explicit dealer/enquiry/send key and the actual outbound recipient. Subject lines and customer names are never used for matching. Reusing an email address for several cars does not merge conversations.

Resend sends signed `email.received` events to `/api/webhooks/customer-email`. The raw body is verified with Svix before JSON parsing. Recognised, unambiguous routes are queued durably; all other mail is ignored without fetching content or creating a lead. There is no marketplace parser.

The worker retrieves the received email from the fixed Resend API, checks its ID, recipient route and sender, and converts HTML to inert text without loading remote resources. Sender mismatches, explicit DMARC failure and retrieval exhaustion require staff review. The incoming record, conversation event and enquiry revision commit atomically. Same-dealer merged enquiries follow the surviving case. Booking, sale, deposit and invoice states are untouched.

Staff see incoming messages in Email and customer conversation history, a Home task and a reminder in the selected customer enquiry. Enrolled devices with enquiry alerts enabled receive a generic push notification. Opening a message does not clear the task. Staff can mark it handled, or a successful staff email to the same recipient handles earlier received replies. Messages arriving after that email was queued stay outstanding. Provider acceptance, rather than delivery/read confirmation, is used consistently with the existing outgoing send contract.

Incoming attachment names/counts are shown. Attachment binaries remain in Resend; downloading incoming attachments through the portal is not included in this release. No attachment/raw-email URLs are fetched or exposed.

## Configuration

All four server-side variables are required before a dealer receives new reply routes:

- `EMAIL_REPLIES_ENABLED=true`
- `EMAIL_REPLY_DOMAINS` — JSON mapping explicitly enabled dealer IDs to verified receiving domains.
- `RESEND_RECEIVING_API_KEY` — separate private Resend credential able to retrieve received emails.
- `RESEND_RECEIVING_WEBHOOK_SECRET` — the signing secret for this webhook.

Shore Drive pilot uses the account's existing `veloopnalu.resend.app` receiving domain, avoiding a paid additional-domain upgrade and changes to root-domain MX. The sender remains `sales@shoredrive.uk`. The receiving key has Resend Full access because its Dashboard does not offer receiving-only access. Masood explicitly approved this scope; it is stored only in Render. Existing sending keys remain restricted.

Resend webhook ID: `1add4ee6-e9e0-4e12-a1a1-87e60f3ed45d` (only `email.received`). Receiving credential ID: `15232a03-a55f-49ce-8f28-4de9cb034151`. Neither value is a secret.

The mapping initially enables only `shore-drive-limited`. No stock-worker delivery flags or schedules are changed. Settings are saved in the Render Dashboard, not duplicated in Blueprint values; future Blueprint syncs must preserve these keys.

## Recovery and limits

- Migration `0052_customer_email_replies.sql` is additive.
- Unique provider receipt IDs prevent webhook replay duplicates; unique send keys keep routing stable.
- Signed webhooks use the library's timestamp tolerance. Invalid signatures get 401; failed durable writes get 503 so Resend retries.
- 64 KB webhook body limit; provider retrieval capped at 2.1 MB streamed bytes and 10 seconds; saved text capped at 24,000 characters.
- Up to five receipts per 15-second worker tick. Recoverable 60-second processing leases; five-minute retry spacing; at most eight claims, then staff review.
- Accepted work is tracked by the existing service lifecycle during shutdown.
- Existing queued emails without routes keep their original transport bytes on retry.
- Disabling the feature stops new routes/processing; do not remove receiving configuration while issued addresses still need to receive replies. Already-issued addresses are not retrofitted into previously sent emails.
- Direct sales emails without an enquiry and account invitations retain their existing reply settings. This release routes emails generated through the enquiry outbox; it does not invent a customer case for unrelated mail.

## Verification

Automated coverage includes signed/invalid/stale/tampered webhooks, duplicate receipts, same customer/different cars, dealer isolation, ignored marketplace email, forged sender, failed authentication, HTML text conversion, attachment metadata, bounded retrieval recovery, exhausted leases, merged cases, stable outgoing retry addresses, newer messages remaining unresolved, staff history/Home, cross-origin actions, and push deduplication. Existing email outbox, email workspace, case-scope and push regressions are run alongside frontend conversation/Home tests and the full build.

Live Shore Drive results are recorded separately after release; do not treat automated fixtures as a live receiving test.
