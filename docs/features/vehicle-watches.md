# Watch this car

Customers may save a car locally without giving contact details, or separately request email price/availability updates. Watching is per dealership and vehicle. It does not reserve stock, create a sale, change an agreed price, or alter bookings, invoices or payments.

## Customer flow and privacy

The vehicle page offers Watch this car only when the dealership has enabled it and its existing email sender is ready. Available and reserved public cars may be watched. Signup records a pending subscription and emails a customer-requested confirmation. A confirmation page GET never activates anything: the customer must explicitly confirm with POST. Confirmation refuses a car that is no longer public/available or reserved.

Verification capabilities are random 32-byte base64url strings, stored as SHA-256 hashes, scoped to the resolved dealer, single-use and valid for 24 hours. Emailed URLs use `/watch#token`; no capability belongs in a query string. Confirmation returns a separate 90-day manage capability. Manage URLs are private; GET lists watches, while explicit POST stops one watch. Stopping updates retains the saved shortlist and does not delete customer records. A customer can request another manage link by email. Signup/manage requests give a generic 202 response without revealing whether an address exists.

Limits are shared in the database: five requests per email per UTC day and 60 per network peer per UTC hour. IP input is the existing Express `req.ip`, not untrusted forwarded headers. Behind Render or another proxy, the peer limit may aggregate visitors unless a separately reviewed trusted-proxy configuration is installed. This change does not globally trust `X-Forwarded-For`.

## Manual staff work

Verified watchers are separate from enquiries. Durable tasks are created for genuine published GBP price reductions, reserved status, reserved-to-available release, and actual sold status. Missing/import-disappeared stock never becomes a sold notification. Unverified watchers and watchers confirmed after an event are excluded from that historical event. Existing buyers, agreed sales/deposits and suppressed email recipients are protected by read-only eligibility checks.

Home groups pending Watch updates; Cars shows active watcher counts. Staff select up to 20 recipients, edit the subject/message, preview, then explicitly send. Closing the editor does not save an edited draft. Preview approval is bound to the event revision, exact wording and recipient identities. Canonical vehicle and personal manage/stop links are added by the server. Every actual provider call checks current stock, recipient eligibility, sender readiness and the dealer switch again, including after provider pacing.

A shared durable recipient claim prevents contextual enquiry and Watch emails for the same dealer/vehicle/price-change/email from sending twice, including simultaneous approvals and later retries. Confirmed Watch sends mark matching enquiry price follow-ups contacted. Confirmed enquiry contacts suppress the corresponding Watch recipient. Known nonacceptance can be reviewed and retried manually; uncertain acceptance remains blocked and must be checked with the provider. No Watch alert worker, schedule or automatic customer alert is installed. The only immediate emails are confirmation/manage links explicitly requested by the customer.

### Reply destination

Where the dealership's existing `replyConfiguration` is enabled, a Watch alert receives an exact private reply route. Only a validated actual reply creates or reuses the matching vehicle/email enquiry; outgoing alerts alone do not fill the Inbox. The existing received-email processor records the incoming message and exposes the usual staff notification. Earlier outgoing Watch messages are attached once. Recipient ambiguity, spoofed senders, DMARC failure, disabled dealers and exhausted processing leases fail closed or await review.

If receiving is not configured, the existing configured sender Reply-To applies. Such replies go to that mailbox; they are not automatically imported into Luxxy's Inbox. No receiving credentials, domains or provider configuration are created by this feature. Staff settings return `repliesReady` to distinguish this from sender readiness.

## API

All paths below are relative to `/api`. Tenant resolution is mandatory in the shared installation. Responses use `Cache-Control: no-store`; private capabilities use the `x-vehicle-watch-token` header. Browser writes require the dealership origin.

| Method | Path | Auth and body | Result |
|---|---|---|---|
| GET | `/vehicle-watches/availability` | Public | `{enabled,emailReady}`; effective enabled includes sender readiness |
| POST | `/vehicle-watches` | Public `{vehicleId,email,website?}`; optional honeypot | Generic 202; confirmation only |
| POST | `/vehicle-watches/verify` | Public `{token}`; explicit confirmation | `{verified,token,expiresAt,emailHint,watches}` |
| POST | `/vehicle-watches/manage-link` | Public `{email,website?}` | Generic 202; requested manage email only |
| GET | `/vehicle-watches/manage` | Private token header | Verification-required summary, or `{expiresAt,emailHint,watches}` |
| POST | `/vehicle-watches/:id/stop` | Private manage token header | `{stopped:true}`; idempotent and customer-scoped |
| GET | `/staff/vehicle-watch-settings` | Staff | `{enabled,revision,emailReady,repliesReady}` |
| PUT | `/staff/vehicle-watch-settings` | `settings.publish`; `{enabled,revision}` | Updated settings; conflict if revision changed |
| GET | `/staff/vehicle-watch-counts` | Staff | `{counts:[{vehicleId,count}]}` |
| GET | `/staff/vehicle-watch-tasks` | Staff | `{tasks,total}`; pending work remains reachable after completed tasks |
| POST | `/staff/vehicle-watch-tasks/:id/preview` | `sales.manage`; `{subject,message,expectedRevision,watchIds}` | Exact review plus recipients, `previewHash`, revision and readiness |
| POST | `/staff/vehicle-watch-tasks/:id/send` | `sales.manage`; preview body plus `{previewHash,requestId}` | `{sentCount,skippedCount,failedCount,uncertainCount,message}`; replay checks the same request's results |

A watch DTO contains `id`, `vehicleId`, `vehicleTitle`, `vehicleUrl`, `imageUrl`, `currentPrice`, `currency`, `status` and `verifiedAt`. A task includes the vehicle, event kind/revision/prices/time, default subject/message, recipient states, pending/uncertain/total counts. Only up to 100 recipient rows are returned, with unfinished recipients first; additional recipients become visible as work is completed.

## Storage and release

Apply migrations in order, including prerequisite `0053_stock_change_customer_outcomes`:

| Migration | Storage/change |
|---|---|
| `0054_vehicle_watches` | `vehicle_watch_settings`, `vehicle_watches`, `vehicle_watch_tokens`, `vehicle_watch_events`, `vehicle_watch_deliveries`, `vehicle_watch_rate_limits`, `vehicle_watch_reply_routes`, `vehicle_watch_reply_receipts` |
| `0055_vehicle_watch_status_events` | Status-transition trigger and per-vehicle event index; no automatic sending |
| `0056_price_update_recipient_claims` | Shared durable price recipient claims and backfill of existing accepted/in-progress contextual sends |

The release uses existing dealer Resend settings, website branding and reply receiving configuration. Existing `SESSION_SECRET` is required to sign preview approval hashes. No browser receives a provider secret. No production migration or deployment is implied by local installation.

Tests run with fictional addresses/transports and disposable database fixtures; they do not send customer emails. Physical device delivery and the configured production email provider require a separately authorized live check after deployment.
