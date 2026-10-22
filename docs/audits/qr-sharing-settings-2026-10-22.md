# QR sharing recheck and staff settings — 22 October 2026

## Changes

- Added Settings → Emails & documents → WhatsApp & QR. One owner-managed switch controls new customer WhatsApp sharing; legacy dealers remain enabled by default.
- Stored the preference in the existing encrypted, tenant-scoped private settings with optimistic revision checks. No migration or public dealership settings change.
- Staff can read only the safe enabled/revision fields. Only owners with integrations.manage can update the preference; normal staff origin and permission checks remain in place.
- The frontend blocks new WhatsApp handoffs when disabled. The backend also blocks new private packs. Issued links, exact retries, existing confirmation and revocation remain available. Phone upload/recording tools and email delivery remain independent.
- Unified desktop and phone message formatting so long-message handoffs, copy, sharing and history retain the same attachment-link text.
- Renewing an expired pack resets old confirmation state. Reopening a prepared unexpired pack remains possible after switching new sharing off.
- Kept selected Settings tabs visible when phone/tablet orientation changes.

## Verification

- Live existing test enquiry rechecked: correct UK WhatsApp number and enquiry, QR displayed, internal email fallback opened. No WhatsApp message sent or falsely marked sent.
- Local rendered Settings tested at 1440px, 820px and 390px. No page horizontal overflow. Saved off, reloaded, verified disabled enquiry action, then restored on.
- Frontend checks: 77 QR/settings/history tests, 89 capture/Quick Enquiry tests; private-store suite 10 tests. Settings navigation checks rerun after responsive adjustment.
- Isolated real HTTP media/sharing suite: 27 tests passed, including real compression, photo limits, customer-history confirmation, revision guards, staff roles, origin checks and dealer isolation.
- Initial concurrent full UI/media runs exhausted the video test time budget. The isolated rerun passed without timeout changes. One asynchronous cache test assertion was corrected to wait for the observable update; final regressions passed.
- Typechecking and production builds passed.

## Limits

- WhatsApp verification remains handoff-only at the user's request. Physical iPhone/iPad/Android camera scans and transport delivery were not independently tested.
- The previous live photo email was received in the user's Gmail inbox with two attachments; no new live emails were sent for this recheck.
- Staff confirmation records staff attestation, not WhatsApp delivery/read status. Personal WhatsApp replies do not sync into Luxxy.
