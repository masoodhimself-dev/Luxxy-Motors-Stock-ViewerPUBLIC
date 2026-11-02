# Cazoo lead email import and AI drafts

Cazoo direct-delivery leads become ordinary dealer-scoped Inbox enquiries (`source=cazoo`) and marketplace sales leads. Importing never sends a customer confirmation or reply. Valid leads receive an editable AI draft if AI is connected, the current car is visible and the existing shared budget permits it. Staff must preview and send through the existing email flow. Unsupported templates remain in Settings > Emails > Cazoo enquiries for review. Stock-import SFTP credentials are unrelated to this email connection.

## Owner setup

1. Deploy migration `0079_cazoo_lead_receipts` and the API/UI release together.
2. Use a dedicated receiving subdomain, proposed for Multi-Choice: `leads.multichoicemotors.co.uk`, mailbox `cazoo@leads.multichoicemotors.co.uk`. These names are a proposal until provisioned. Do not replace the main dealership domain's MX records or alter existing mailboxes.
3. Add the receiving subdomain in Resend and its provider-issued verification/MX records in DNS. Confirm verified receiving before changing the delivery address in Cazoo. Domain provisioning may count toward the current Resend domain allowance; inspect the account before adding paid capacity.
4. Add a Resend `email.received` webhook at `https://multichoicemotors.co.uk/api/webhooks/cazoo-leads`. Keep the existing customer-reply webhook. Save the new signing secret server-side as `CAZOO_LEADS_WEBHOOK_SECRET`; never expose it in public settings, chat or source.
5. Reuse the server-side `RESEND_RECEIVING_API_KEY` (with receiving access) and set `CAZOO_LEAD_MAILBOXES` to a JSON object of exact dealer IDs to dedicated mailbox addresses. Each mailbox must appear only once. Never infer the dealer from a customer name, registration, subject or body.
6. Enable `CAZOO_LEADS_ENABLED=true`. Existing `AI_ASSISTANCE_ENABLED`/`OPENAI_API_KEY` enable draft creation; otherwise import still works and staff can reply manually. Customer replies to approved outbound mail use the existing customer-reply configuration.
7. In Cazoo, change only the lead-delivery address to the verified dedicated mailbox. Send a fictional lead first; confirm Inbox, correct stock match, customer recipient, saved draft and no automatic send. Keep Gmail delivery until the receiving flow has been verified, if Cazoo supports a copy. Do not resend or reply to an existing real lead as a test.

## Safety and behaviour

- Webhook: raw-body Svix verification, 64 KB event bound, no public import endpoint.
- Receipt retrieval: existing fixed Resend API host, redirects refused, streamed-byte bound, ten-second timeout; no email/attachment links fetched.
- Source: exact `dealerleads@info.cazoo.co.uk`, provider-reported DMARC pass required. Missing/failed authentication stays in review; apparent From alone is not proof. Forwarded templates are not supported in this first direct-delivery version.
- Text and HTML use the same strict section parser. A unique correlation ID and customer email are required. More than one candidate is reviewed rather than guessed. No customer email is taken from the Cazoo sender or footer.
- Deduplication: unique provider ID globally plus unique dealer/correlation ID, transaction lock, atomic enquiry and marketplace-lead creation. Retries are recoverable after process restart; eight failed retrieval attempts go to review.
- Vehicle: exact normalized registration, within that dealer's Cazoo stock only. Missing or ambiguous matches import an unlinked enquiry for staff attention; they never select another dealer's stock or automatically generate a draft.
- AI: uses current public vehicle/dealer facts and existing shared $5/month application allowance, plus ten automatic drafts per dealer per UTC day. Customer contacts are redacted. No public cache. Budget failure does not lose the lead. Existing staff drafts, revised/merged/closed cases and cases with outbound emails are not overwritten.
- No separate worker service or cron subscription: the lifecycle-aware, bounded worker runs in the existing web service. Queue state is durable PostgreSQL data.
- Review copies are inert text and removed after 30 days. Imported enquiry content follows existing customer-record retention. Deleting an enquiry cascades its receipt/draft; provider deduplication history for that enquiry is therefore removed too.

## Verification

`pnpm --filter @workspace/api-server test:cazoo-leads`

The tests use isolated PGlite fixtures and mocked receiving/AI providers. No customer email is sent and no production data is imported. Include existing customer reply, email workspace and AI assistance regression checks. The local preview honestly shows "Not connected yet" until the real receiving setup is completed.
