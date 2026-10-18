# Portal workflow controls

Operator guide for customer matching, test-drive declarations and platform feature controls. These workflows keep the existing dealership permissions and individual staff accounts.

## Test-drive declaration and QR code

1. Open **Portal → Test drives**, select the booking and choose **Declaration & QR**. Staff need `sales.manage` permission.
2. Confirm the appointment and its stock car first. The server checks that the appointment is active, the enquiry is not closed or merged into another case, and the car is available or reserved rather than archived.
3. Choose **Create signing link**. The dialog shows a private link and QR code. Creating a link sends no email. Copy it, let the customer scan it, or use the permitted email composer to review and send it.
4. The customer opens the dedicated page without an account, checks the vehicle and appointment, reads the statement, types their name and explicitly confirms acceptance. The record stores the accepted statement/version/hash, typed name and signing time.
5. Staff separately record the licence and insurance checks. A typed signature is a customer declaration; it does not verify identity, establish insurance cover, approve the driver or waive statutory rights. Staff must complete the actual checks before allowing the drive.

The UI requests a **48-hour maximum** link lifetime. It can expire earlier: the server caps access at the appointment end plus two hours. Share the private link only with the intended customer; possession permits access and signing. The database retains its token hash, not the recoverable link. Create a replacement if the original link is no longer available.

A replacement revokes previous unsigned links and preserves history. Revocation, expiry or a changed car/appointment prevents further use of an old link. Signed records remain available to staff; link expiry alone does not undo an acceptance for the same still-current appointment. Refresh and create a replacement after details change.

### Declaration API notes

Staff list/create: `GET/POST /api/staff/enquiries/:id/test-drive-declarations`. Creation requires `requestId`, a random 64-character hexadecimal `token`, `expectedAppointmentRevision` and `expectedVehicleId`; the UI supplies `expiresHours: 48`. Stale car/appointment expectations return `409`. Retry an ambiguous failure with the same request and token.

Customer read/sign: `GET/POST /api/test-drive-declarations/:token`. Signing requires a request ID, typed name, explicit acceptance and the statement version/hash. Exact retries are idempotent; different submissions cannot overwrite a signature. Staff revoke/check endpoints are beneath `.../:declarationId`; check updates require `expectedRevision`.

## Platform feature controls

On the approved platform administration host, use **Feature defaults** for inherited settings, or **Dealerships → select dealer → Features** for one dealership. Only authorised platform administrators can change these controls. Every saved change requires a reason and records its actor, time and revision.

| Control | What switching off stops |
| --- | --- |
| Website enquiries | New general website enquiries and callback requests |
| Part exchange | New website part-exchange requests |
| Test-drive bookings | New customer/staff bookings, confirmations and rescheduling |
| Test-drive declarations | New signing links and customer signatures |
| AI reply drafts | New generated staff reply suggestions |
| Customer email delivery | New sends and queued retries at the provider boundary |

Choose **Use platform default**, **Enabled** or **Disabled** for a dealer. An explicit dealer override takes precedence over the platform default: changing a default does not override an explicit dealer setting. An optional future switch-off date is enforced against server time without leaving the dashboard open. The date input uses the administrator browser's displayed timezone.

Enabling a feature still requires the dealership’s own settings and integrations. These controls do not create provider accounts, install API keys or expand the server’s AI dealer allow-list.

Existing records, cancellation, declaration revocation and applicable staff checks remain accessible. Saved email drafts/history remain available; paused deliveries do not contact the provider or spend a send attempt. Availability lookup failures block new actions until the policy can be checked. Conflicting edits require a reload.

Website chat, online card reservations, vehicle comparison and recent handovers remain release-restricted. Platform/dealer settings cannot re-enable them. These platform policies apply to the shared multi-dealer installation; standalone deployments preserve their existing release policy. Dealer settings editors retain the saved values rather than writing temporary platform restrictions back into the settings.

## Customer matching and merges

Phone/email matches suggest records for review; they do not prove identity. UK phone forms (`0`, `+44`, `0044` and `44`) compare consistently. Email comparison ignores case and surrounding spaces but preserves dots and plus tags. Names alone or number suffixes do not establish a match. Conflicting names/contact details and shared household/business contacts require review.

Review the originals before combining a case. Explicit confirmation is required for potentially different customers. A merge preserves each original customer/contact, vehicle, messages, conversation history and management links. Choose which appointments to keep and review any cancellations. A merge does not merge sales/payment reservations or send customer email. See [Enquiry and test-drive cases](enquiry-merges.md).

## Staff access and rollout

Keep Clerk individual staff sign-in and the application's dealership membership/role checks. Individual accounts support audit attribution and removal of one person's access. A shared PIN would lose that accountability; no shared PIN or replacement authentication is introduced. Platform administration remains separately restricted.

Migrations `0043_test_drive_declarations` and `0044_feature_controls` are required for the new shared-backend storage. The configured Render pre-deploy migration command applies them before the new server starts. Local platform feature controls are a read-only layout preview. Automated/browser checks do not establish that every physical phone or tablet has been tested, nor do they certify legal suitability of a dealer's declaration or insurance arrangements.
