# Notifications home and customer reply drafts

## Staff workflow

`/portal` now opens Notifications. Existing `?section=overview` links still open the reporting dashboard. Notifications is an actionable work list, not a record of messages that staff have "read". Opening a notification does not mark an enquiry contacted or complete a follow-up.

The home shows enquiries awaiting a first staff reply, overdue follow-ups, pending future bookings and today's appointments, saved replies, and recorded enquiry email failures/uncertain acceptance. Each category shows its real total and at most eight records. Times and calendar boundaries use Europe/London. Email categories require `sales.manage`; no private email draft content is included in the home response.

## Combined customer workspace

Notifications contains four views: Needs attention, Customers & enquiries, Test drives, and Email. Email, Enquiries and Test drives no longer have separate main navigation entries. Existing links with `section=email`, `section=enquiries` or `section=test-drives` still open the corresponding view. Canonical links use `/portal?section=notifications&workView=attention|customers|test-drives|email`. This is client-side compatibility, not an HTTP redirect.

Selecting a customer carries their enquiry ID between the customer record, bookings and email. Show all actions clear the selection. Bookings include explicitly merged enquiry records, and the Calendar remains a dealership-wide view. An unavailable selected record never silently falls back to all customer email. Staff without email permission retain customers and test drives but cannot mount the email workspace or composer.

The selected customer record includes an expandable Email & drafts card. It loads recorded outgoing messages only when expanded and does not check the external provider automatically. Preparing a reply uses the original enquiry and its saved draft. Email history and the drafts queue accept an optional `enquiryId` filter, resolved on the server through explicit merge relationships within the authenticated dealership. Matching email addresses or phone numbers do not automatically combine customers. Filters apply before pagination; invalid IDs return 400 and unknown or other-dealership IDs return an empty result.

Prepare reply opens a customer-linked composer. Save draft retains incomplete copy and attachment selections without contacting any external service. Email opens on Drafts to review; Sent & delivery retains the existing outgoing journal, saved copies and provider checks. Incoming replies are still not connected. Notifications about failed email link to the relevant customer's recorded outgoing messages.

Review email saves the current draft and uses the existing server preview. Staff then explicitly confirm sending. Current vehicle facts and private attachments are revalidated by that preview/send workflow. A changed enquiry requires an explicit refresh of facts; the body is not silently rewritten. Existing service-book, pre-accident photo and invoice attachment protections remain in place.

## Persistence and safeguards

Migration `0037_email_drafts` creates one shared working reply per `(dealer_id,enquiry_id)`, with a composite enquiry/dealer foreign key. Drafts have a monotonically increasing version, source, actor, saved content and state. They are shared by authorised sales staff of that dealership, rather than stored in a browser or shared across tenants. Save/discard use enquiry row locks and optimistic versions; conflicting staff edits return 409 and leave on-screen text intact. Discard clears content but retains a version tombstone so an older tab cannot resurrect it. Enquiry deletion cascades to its draft.

The new endpoints require staff authentication, sales permission where applicable, same-dealership origins and private/no-store responses:

- `GET /api/staff/notifications`
- `GET /api/staff/email-drafts` — latest 100 active drafts, with `hasMore`; optional UUID `enquiryId` scopes the queue
- `POST /api/staff/enquiries/:id/email-draft` — `{ expectedVersion, content }`; new rows use version 0
- `POST /api/staff/enquiries/:id/email-draft/discard` — `{ expectedVersion }`

The existing email-context response includes `version` and `savedDraft`. The reviewed send contract accepts optional `savedDraftVersion`, checks both the version and exact normalised saved copy, and claims the draft as sending in the same transaction as the idempotent delivery journal. Accepted sends leave the working queue; definite provider rejections return the draft for correction. Uncertain acceptance and interrupted sends remain visible but cannot be edited or discarded into a new send. The original immutable request can still be retried idempotently. Checking provider history is necessary before any manual recovery of uncertain records.

No draft write route can invoke an email provider, generate AI text, approve itself or set its own source to AI. Existing reviewed-send callers without `savedDraftVersion` retain the previous contract. Previously configured customer confirmations and appointment reminders retain their existing settings.

## What "ready for AI" means here

This release supplies the persistent review queue and records where a draft came from. The database reserves `source=ai`; public staff save requests cannot claim that source. AI calls, automatic draft generation and new automatic sending remain disabled. No key, paid service, recurring job or customer email is created by this work.

A later release can add a server-only generator that reads a scoped enquiry plus approved vehicle facts and creates a suggestion in this queue. That release still needs operator enablement, budgets/rate limits, input/output bounds, generation deduplication and stale-fact checks. Auto-send would be a separate opt-in workflow with its own approved templates and limits, using the existing delivery journal. This release does not claim those features are implemented. Opening an enquiry does not generate a paid call.

## Local review and rollout

The loopback-only Vite preview offers the same main navigation, notification links and no-send draft preparation. Preview drafts are intentionally in memory and reset when the preview server restarts; production drafts use PostgreSQL. The preview cannot send email, even if real sender settings exist elsewhere. It does not write or change saved preview customer records.

Before deploying the application, apply migration 0037 using the normal deployment migration step. No production migration or deployment was performed for this change. Test with isolated fictional customer records before enabling for dealerships.

Verification covers two-dealer isolation, origin checks, staff permissions, merged-case email filtering, concurrent draft writes, stale saves, discarded-draft resurrection, exact reviewed sends/replays, and uncertain provider outcomes using a fictional in-memory database and mocked sender. UI checks cover legacy links, customer context, scoped bookings and email, role-dependent views, draft restoration, retained conflict text and save-without-send. Desktop, tablet and phone layouts are checked in the local browser.
