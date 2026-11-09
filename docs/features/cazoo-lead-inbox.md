# Cazoo lead email import and replies

Cazoo direct-delivery leads become dealer-scoped Inbox enquiries (`source=cazoo`) and marketplace sales leads. Background AI drafts require explicit dealership opt-in, connected AI, verified Cazoo stock and the dedicated mailbox. Automatic first replies require a second opt-in. Unsupported messages appear in Settings > Emails > Cazoo enquiries for review.

## Owner setup

1. Deploy migration `0079_cazoo_lead_receipts` and the API/UI release together.
2. Use a dedicated receiving subdomain, proposed for Multi-Choice: `leads.multichoicemotors.co.uk`, mailbox `cazoo@leads.multichoicemotors.co.uk`. These names are a proposal until provisioned. Do not replace the main dealership domain's MX records or alter existing mailboxes.
3. Add the receiving subdomain in Resend and its provider-issued verification/MX records in DNS. Confirm verified receiving before changing the delivery address in Cazoo. Domain provisioning may count toward the current Resend domain allowance; inspect the account before adding paid capacity.
4. Prefer reusing the existing signed `/api/webhooks/customer-email` webhook and its existing receiving key/secret. It now dispatches Cazoo deliveries by the exact dedicated mailbox. No new webhook or credential is needed for an already-connected receiver. Alternatively, add a separate Resend `email.received` webhook at `https://multichoicemotors.co.uk/api/webhooks/cazoo-leads`. Keep the existing customer-reply webhook. Save the new signing secret server-side as `CAZOO_LEADS_WEBHOOK_SECRET`; never expose it in public settings, chat or source.
5. Reuse the server-side `RESEND_RECEIVING_API_KEY` (with receiving access) and set `CAZOO_LEAD_MAILBOXES` to a JSON object of exact dealer IDs to dedicated mailbox addresses. Each mailbox must appear only once. Never infer the dealer from a customer name, registration, subject or body.
6. Enable `CAZOO_LEADS_ENABLED=true` for lead import. To opt one dealership into background AI draft creation, the owner must also configure `AI_ENQUIRY_AUTOMATION={"exact-dealer-id":{"provider":"cazoo","enabled":true}}`, alongside `AI_ASSISTANCE_ENABLED=true` and the private `OPENAI_API_KEY`. No opt-in is inferred from Cazoo stock. Omitted, false or malformed opt-ins leave background AI off; import still works and staff can generate drafts and reply manually. Customer replies to approved outbound mail use the existing customer-reply configuration.
7. In Cazoo, change only the lead-delivery address to the verified dedicated mailbox. Send a fictional lead first; confirm Inbox, correct stock match, customer recipient, saved draft and no automatic send. Keep Gmail delivery until the receiving flow has been verified, if Cazoo supports a copy. Do not resend or reply to an existing real lead as a test.

## Safety and behaviour

- Webhook: raw-body Svix verification, 64 KB event bound, no public import endpoint.
- Receipt retrieval: existing fixed Resend API host, redirects refused, streamed-byte bound, ten-second timeout; no email/attachment links fetched.
- Source: exact `dealerleads@info.cazoo.co.uk`, provider-reported DMARC pass required. Missing/failed authentication stays in review; apparent From alone is not proof. Forwarded templates are not supported in this first direct-delivery version.
- Text and HTML use the same strict section parser. A unique correlation ID is required. Matching address and link text in Customer details count as one email address. A verified lead with no customer email enters the Inbox for staff to check. Conflicting or malformed email addresses stay in review, and no customer email is taken from the sender, action links or footer.
- Cazoo Availability enquiries can arrive without a written message. The Inbox notes this so staff can recognise the enquiry type.
- Deduplication: unique provider ID globally plus unique dealer/correlation ID, transaction lock, atomic enquiry and marketplace-lead creation. Retries are recoverable after process restart; eight failed retrieval attempts go to review.
- Vehicle: exact normalized registration, within that dealer's Cazoo stock only. Missing or ambiguous matches import an unlinked enquiry for staff attention; they never select another dealer's stock or automatically generate a draft.
- AI: uses current public vehicle/dealer facts and existing shared $5/month application allowance, plus ten automatic drafts per dealer per UTC day. Customer contacts are redacted. No public cache. Budget failure does not lose the lead. Existing staff drafts, revised/merged/closed cases and cases with outbound emails are not overwritten.
- Eligibility is rechecked before background draft generation: active non-demo dealership, explicit exact dealer/provider AI opt-in, effective enabled stock connection, a completed import for that dealer/provider/retailer, global AI readiness, and the exact dedicated mailbox with receiving key and signed webhook configured. Unknown private stock settings fail closed. A receipt from another mailbox or another dealer cannot grant access. Removing any connection stops new background draft generation; manually requested AI drafts retain their existing access and budget rules.
- Set `AI_CAZOO_AUTOMATIC_REPLY_DEALERS` to a JSON object mapping exact dealership IDs to UTC ISO activation times. Only verified leads received from activation onwards can qualify. Automatic replies require outbound delivery and inbound reply routing. Remove a dealership from the map to turn off its automatic first replies.
- Automatic replies use fixed wording for standalone availability questions and require a current, available, uniquely matched vehicle. Other questions use the draft flow. The email outbox records delivery and replies return to the same Inbox enquiry.
- `GET /staff/cazoo-leads` reports `automaticDraftsEnabled`, `automaticRepliesEnabled`, `mode` and blocker codes. Auto Trader has no automatic reply adapter.
- No separate worker service or cron subscription: the lifecycle-aware, bounded worker runs in the existing web service. Queue state is durable PostgreSQL data.
- Review copies are inert text and removed after 30 days. Imported enquiry content follows existing customer-record retention. Deleting an enquiry cascades its receipt/draft; provider deduplication history for that enquiry is therefore removed too.

Dealership owners can turn on **Forward new Cazoo leads to the owner** under **Settings → Emails → Cazoo enquiries**. DealerOS still imports leads into the Inbox or holds them for review. It emails a text copy of each verified Cazoo lead to the saved owner address, including genuine leads with missing customer contact details. Copies have their own delivery status and do not count as customer replies. An owner can forward an eligible earlier receipt from the same panel.

## Verification

`pnpm --filter @workspace/api-server test:cazoo-leads`

The tests use isolated PGlite fixtures and mocked receiving/AI providers. No customer email is sent and no production data is imported. Include existing customer reply, email workspace and AI assistance regression checks. The local preview honestly shows "Not connected yet" until the real receiving setup is completed.


## Temporary owner test delivery

`CAZOO_OWNER_TEST_SENDERS` is an owner-managed JSON map from exact dealer ID to
`{email, expiresAt}`. Addresses must be exact (no domains/wildcards), expiry must
be within the next eight days, and provider DMARC must pass. No rule changes
normal Cazoo sender verification or recipient-to-dealer routing.

An authorised owner can forward a single known-layout Cazoo enquiry or send a
plain question with subject `Enquiry - Audi A5 MW62VLP - Test`. Forwarding
headers and previous dealer replies are excluded from extraction. Imported
contact is always Owner test at the approved owner email, with no original
customer phone. A namespaced provider-ID hash prevents the test consuming the
real Cazoo correlation ID. Tests are labelled in the receipt and staff note.
Drafts remain review-only and use the existing budget and daily limit.

Remove the environment rule to end testing immediately; otherwise it expires
automatically. The signed receiving webhook, authentication and all unrelated
dealership behaviour remain unchanged.
