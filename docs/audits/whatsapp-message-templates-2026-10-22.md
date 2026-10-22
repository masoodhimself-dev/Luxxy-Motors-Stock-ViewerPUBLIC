# Editable WhatsApp templates — 22 October 2026

## Result

Added independent dealership WhatsApp wording under **Settings → Emails & documents → WhatsApp & QR**. Owners can edit ten standard templates, insert allowed customer/car placeholders, preview fictional examples, save, undo and restore defaults. Staff can select a saved template in any shared WhatsApp panel and personalise that message before updating its QR. Saving a template does not overwrite an existing prepared message or change email wording.

Templates cover enquiry replies, car details, photos, video, test-drive details, post-visit follow-ups, invoices/documents, reservations, declarations and private customer pages. Supported placeholders: `customer_name`, `dealer_name`, `vehicle_title`, `vehicle_registration`, `appointment_time`, `message`.

## Behaviour and safeguards

- Template settings require existing `integrations.manage` permission. Staff may read templates. Existing tenant and same-origin protections apply.
- Existing encrypted dealer settings hold overrides; no database migration or client secrets are added.
- Template placeholders validate against a fixed allowlist. Values are substituted literally once. Reviewed one-off messages are plain text, up to 4,000 characters.
- Per-message edits hide the previous QR and disable confirmation/email handoff until staff applies or undoes the change.
- Private source facts, document numbers, appointment status and selected attachment links remain separate from editable prose. PDF bytes and issued calculations are unchanged.
- An edit creates a new frozen private pack rather than modifying a link already shared. Uncertain retries use the same request identity. Reopening and expiry renewal retain applied wording.
- Large messages use a secure phone preview; their public car/signing link remains in the customer message. They do not gain an unnecessary private attachment footer.
- Anonymous pack responses expose only the approved customer-facing message and files, not original removed prose, editing variables or internal identifiers.
- “I’ve sent it” saves exactly the updated message through the existing idempotent history flow. This is staff confirmation, not delivery verification. Editing is locked after confirmation starts.
- Sharing a public vehicle link with a different customer resets personalised wording and recipient fields.
- Internal email fallback retains an applied enquiry message and its attachments for fresh staff review. No mailto fallback is introduced.

## Verification

- **1,831/1,831 frontend tests** across 174 files passed. New coverage includes per-message edits, dirty QR gating, literal placeholders, required details, long-message handoff, recipient identity, exact history text, safe retries, expiry renewal, defaults, conflict handling and permissions fixtures.
- Final focused ShareQr regression after customer-reset hardening: **22/22 passed**.
- **33/33 API/media tests** passed, including owner/staff roles, revision conflicts, tenant boundaries, unchanged legacy hashes, frozen attachments and removed-prose privacy.
- **16/16 email design tests** passed. Full production workspace build/typechecks passed; final frontend build/typecheck repeated after integration.
- Browser tested on local fictional records at **390 × 844**, **820 × 1180** and **1440 × 1100**: saved/reloaded wording, selected template interpolation, manual edits, refreshed number/message QR, protected facts, responsive controls and no horizontal page overflow.
- No real WhatsApp send, live “I’ve sent it”, customer email, financial transaction or stock update was performed.

## Release

Prepared locally on a separate Codex branch. No Render deployment or migration performed for this change. Existing live delivery behaviour is unchanged. Real-device WhatsApp sending remains a staff action.
