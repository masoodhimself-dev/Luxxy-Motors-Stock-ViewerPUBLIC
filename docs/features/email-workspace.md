# Dealer Email workspace

The combined Home workspace and persistent Drafts to review queue are described in [Notifications and reply drafts](notifications-and-reply-drafts.md). Email sits inside Home, with saved drafts and Conversations. Existing `section=email` and `view=sent` links remain compatible.

Portal → Notifications → Email brings together staff enquiry messages, emailed sales documents, and the latest recorded automated customer confirmation/reminder for each enquiry. It is an outgoing-mail workspace; incoming replies are not connected. Search covers customer name, recipient, subject/document title, vehicle and reference, with 50-item pagination. Messages link to their enquiry, customer history, car workspace and sale/PDF where available. Each query is scoped to the authenticated dealership and requires sales permission. An optional `enquiryId` scopes history to that record's explicitly merged case before pagination; it never groups records solely by contact details.

Conversations place original website enquiries on the left and dealership emails on the right, in chronological order with date separators. Staff-captured enquiries are labelled as recorded details rather than incoming emails. A conversation opens its own scoped history rather than relying on whichever messages matched the list search. Earlier messages load in 50-record pages, while unlinked sales remain separate conversations. Failed and acceptance-unconfirmed attempts keep explicit status labels; automated confirmations and sales-document entries are labelled summaries where the original email text was not archived. Selecting an email retains its attachment and delivery controls. Viewing history never sends mail or runs outbox recovery. External inbox replies still require a future incoming-mail connection, and the UI states that limitation.

`GET /api/staff/email?includeBody=true` returns saved text only when a UUID `enquiryId` or `saleId` is supplied. These scopes are mutually exclusive, applied before pagination and always dealer-scoped. The global list omits bodies. The enquiry scope includes explicitly merged records; the sale scope matches one sale only. Customer summaries use these same case-scoped endpoints and do not search by reference/contact as an identity shortcut.

## Compose and attachments

Choose an existing customer enquiry, apply an editable template, select attachments, review the server-generated copy and confirm sending. A new customer should be logged as an enquiry first. Settings' existing email-template editor includes vehicle details, service-book photos, pre-accident photos, appointment details and saved-invoice copy. Photo templates select the appropriate category; unavailable category/appointment/invoice templates cannot be applied. Staff can still edit the copy and attachment selection before reviewing.

Up to six private vehicle photographs and three saved invoices can be attached, with a 15 MB combined attachment limit. Invoice selection requires the same dealer, vehicle and linked enquiry/customer identity. The original archived PDF is reused, not recreated from current settings or payments. Photos retain the existing private-upload authentication. Changing facts or attachments invalidates an earlier preview. Exact-send retries retain the existing idempotency journal; empty document selection preserves pre-upgrade request hashes.

Migration `0026_email_workspace` adds document selections, rendered text and attachment metadata to the enquiry-email journal and a dealer-scoped provider-status cache. New customer messages preserve the rendered copy and attachment names/sizes. Older manual messages retain the previously stored message text. Historic sales entries use their document title/reference and original PDF; historic automatic entries expose the latest recorded notification status, not an invented complete correspondence archive.

## Delivery and opened status

Check delivery status retrieves the saved message's Resend email ID using only that dealer's configured credential. It does not send or resend anything. Requests use a fixed HTTPS API host, refuse redirects, expire after ten seconds, and validate the returned ID and recipient. Results are cached for one minute and stored so subsequent visits show the last verified status. Unknown responses and errors retain previous results. Sending-only API keys may need retrieval permission; the portal reports this instead of calling an accepted email delivered. Resend may no longer expose old provider records, while local history remains available.

Submitted/sending/failed/acceptance-unconfirmed states remain distinct from provider-confirmed delivered, delayed, bounced, complained, opened and clicked events. Open/click tracking must be enabled on the sender domain in Resend; this feature does not change that external setting. Opened is an image-loading signal, affected by privacy tools and image blocking. It is never displayed as a confirmed read/seen receipt or used to infer that an absent event means unread.

Endpoints: `GET /api/staff/email`, `GET /api/staff/email/message/:key`, and `POST /api/staff/email/message/:key/status`. Existing enquiry preview/send and invoice email endpoints remain responsible for delivery. No new paid infrastructure, incoming-email webhook or external credential is created here.

## Verification

Fictional-database HTTP checks cover independent dealer histories, message/record links, templates, original invoice attachment bytes, wrong-customer rejection, exact/concurrent send retries, retained historical text, status caching, provider permissions and unknown-event rejection. UI checks cover history navigation, opened wording, editable templates, selecting invoice attachments and reviewing without sending. Retention/inventory/sales regression checks and production builds also run. Tests use an injected mock Resend transport and send no real customer emails.

## Customer email design

Customer emails share the responsive branded renderer described in [the email design audit](../audits/email-design-2026-10-14.md). Settings → Email templates controls shared branding and individual subject/message/title overrides, with server previews and a plain-text view. Recorded facts and attachments are added by the sending workflow; missing facts are hidden, and document balances use their issue-time snapshot. Existing stored emails and original PDFs stay unchanged.
