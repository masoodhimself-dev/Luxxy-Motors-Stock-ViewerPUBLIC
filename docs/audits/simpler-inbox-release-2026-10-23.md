# Simpler Inbox — 23 October 2026

## Changes

- One Inbox navigation entry for enquiries and customer conversations. Existing email links remain valid; Email records & drafts remains available inside Inbox for delivery checks, sales emails and saved drafts.
- One tenant-scoped reply-attention lookup supplies list badges, reply filter counts, ordering and selected enquiry state. Pending replies on merged originals remain visible. Shared contact details do not automatically merge records.
- Sent enquiry emails suppress the obsolete first-reply task, matching Home's existing sent-email rule. Prepared/failed emails do not count as sent. New incoming replies return the case to attention. No status, booking or sale is mutated by this display logic.
- Latest pending accepted customer reply preview on the list; sender-review messages retain explicit review status.
- One primary conversation history with existing email, phone and staff-confirmed WhatsApp events. Known quoted email chains fold behind Show original message; originals remain intact.
- Compact contact/car summary and simpler action wording. Appointment/customer history, delivery details and occasional record tools expand on demand. Existing appointment actions and scheduled tasks remain accessible.
- Compact selected-car summary on phones in Quick Enquiry, with full details still available.
- Failed reply-count requests visibly warn and offer Retry. Opening a case never marks replies handled or sends anything.

## Validation

- Production build, including workspace typechecking: passed.
- Focused frontend tests: 180 passed; additional WhatsApp/QR, booking, Home, merge/navigation tests: 104 passed (includes four overlapping reply-attention tests; 280 unique tests across 17 files).
- Backend receiving/reply integration suite: 12 passed, including dealer isolation, new aggregate counts, original reply handling, idempotency, authentication and sending behaviour.
- New responsive browser checks: 3 passed at 390, 834 and 1440px, blocking all writes. Validates reply and no-task counts, selection, quoted-history folding, visible actions and no horizontal document overflow.
- Browser inspection of local rendered Inbox and compact contact/car/actions at desktop, tablet and phone viewports.

Physical iPhone/iPad hardware, actual keyboard and actual email/WhatsApp sends are not part of this release's responsive checks. Existing send paths are covered by component/backend regression tests; no customer messages or live bookings were created for this release.

## Release and rollback

No new schema migration or environment setting is required. Stock import configuration, schedules, credentials, sales calculations and delivery rules are unchanged. Marketplace email importing remains paused. The additive aggregate endpoint retains its existing enquiry-scoped form and permissions.

Deploy through the existing shared Render service only after tests pass. Previous live commit: `79318c2fad4346c0321334f9335f80e141fbe074`. Code rollback is compatible because this release adds no database schema changes. Do not reverse customer messages or other live data during rollback.
