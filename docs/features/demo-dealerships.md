# Demo dealerships

Platform administration → Demo dealerships creates a separate tenant with its own ID (`demo-<slug>`), website name/logo, stock source, owner membership, expiration and email test recipient. Existing paying dealers are not converted. No Grok agent, schedule, DNS record, certificate or mailbox is created by this API.

## One-time setup

The operator selected the existing test domain **luxxyexmaplenumber2.uk**. Proposed demo namespace: **demo.luxxyexmaplenumber2.uk**, so a fictional example is `smith.demo.luxxyexmaplenumber2.uk`. Do not replace the existing apex domain's dealer mapping.

1. Apply additive database migration `0029_dealer_demos` before starting the new backend.
2. Configure the wildcard demo hostname on the existing Render service, its required wildcard DNS/ownership records, and confirm HTTPS. Configure Clerk to support staff sign-in on those hosts. The dashboard does not provision these services or bypass their verification.
3. Set `DEMO_BASE_DOMAIN=demo.luxxyexmaplenumber2.uk`. Set `DEMO_DOMAINS_READY=true` only after real DNS/TLS/authentication checks. A platform-owned subdomain is registered as verified in the application; individual prospect domains do not inherit this treatment.
4. Verify a demo sending domain in Resend. It may be `demo.luxxyexmaplenumber2.uk` after its required DNS records are configured. Set `DEMO_EMAIL_DOMAIN`, `DEMO_RESEND_API_KEY`, `DEMO_RESEND_VERIFIED=true`. Store the key in secure runtime configuration, never in this file or browser code.
5. Set `DEMO_EMAIL_RECIPIENTS` to explicit operator-approved inbox addresses. The user's reply “same” did not establish a literal recipient; verify the existing address before configuring it. No address has been guessed.

Missing infrastructure disables creation; missing verified email configuration disables sending. Demo sender identities are `demo-<slug>@<DEMO_EMAIL_DOMAIN>`; these are sender addresses, not created mailboxes. All actual delivery recipients are replaced server-side with the demo's allowlisted operator address, including templated messages, manual messages and attachments. Subjects and bodies carry a demonstration label. Private per-dealer email settings cannot bypass this. Background reminder jobs skip demo tenants; deliberate staff test sends remain available.

## Workflow

1. Create demo with business name, subdomain, small logo, one authorised stock marketplace, retailer reference and test recipient. Expiry defaults to 14 days (1–90 allowed). Your signed-in administrator becomes the dealer owner.
2. Open its Stock connection tab and create a dedicated credential. Give it only to that dealer's Grok worker through the secure secret workflow. Collection remains manual/worker-managed; no claim of an automatically connected bot.
3. Import a complete authorised snapshot through the existing tenant-specific import API. All ordinary importer validation/quarantine rules still apply.
4. In Demo controls, type the exact demo ID and Save starting point. This snapshots current stock/photos/branding and recreates fictional activity. Replacing a baseline is an explicit destructive action on practice activity.
5. Share its public website and authorised portal. The site has a demo banner and noindex/noarchive headers plus disallow robots. It is not password protected by this feature; unlisted is not private access control. Do not upload real customer information. Stripe checkout is blocked server-side regardless of editable settings. New sales documents carry SAMPLE / DEMO dealer branding.

## Fictional activity

Three fictional enquiries, one upcoming test drive, one follow-up, a deposit sale and a full invoice sale with three dated confirmed sample payments. Where stock exists, the first car is reserved by the example deposit. These are sample ledger entries, not actual money. If fewer than two cars exist, the second sale uses an explicitly labelled example vehicle, without inventing facts about an actual car. Email addresses use `example.invalid`. No messages are sent by seeding.

## Reset semantics

- **Reset demo activity:** clears the current enquiry/lead/reservation/chat/email activity and sale workspaces, releases demo lifecycle flags, and recreates fictional activity around current stock. Keeps branding, stock facts/photos, source import history, staff and credentials.
- **Restore original demo:** does the same activity reset, then restores the saved vehicle/photo rows and branding before rebuilding samples. Extra practice inventory is removed. Staff inventory photo/preparation rows attached to deleted cars cascade away. Original means the explicitly saved starting point, not the dealership's first ever stock file.
- **Extend:** resets expiry to now plus the selected days; dashboard offers 14 days.

These endpoints require approved platform host + administrator + same-origin checks, exact typed ID and revision, and lock a `dealer_demos` record transactionally. A non-demo dealer cannot be reset. Legacy sales cause refusal rather than deleting old accounting ledgers. Baselines are server-generated, never supplied by a reset request. Settings restoration creates a new settings revision; existing history is retained. The action records the last actor/revision/reset date. There is no automatic deletion of expired demos.

Pause the demo worker and finish open staff actions before resetting: stock/sales/settings locks coordinate those stores, but this is not a global freeze of all in-flight staff requests. A later stock import can overwrite original stock restored by reset. Import history/idempotency/order checks remain intact. Reset does not operate on live external systems or revoke credentials. Expired demos reject website and import traffic with 410 until extended. Expiration is not data deletion.

Conversion to a paying dealer and permanent deletion remain deliberate operator workflows; this release does not silently strip demo restrictions or enable payments/email. Configure a regular dealer and clean production credentials/domain when onboarding a paying customer.

## Verification

- Isolated platform test: additive migrations, guarded creation, approved-recipient enforcement, duplicate rejection, fictional seeding, missing baseline refusal, stale revision rejection, original/current-stock reset, live dealer protection, email redirection, payment blocking and expiry.
- Frontend unit checks: disabled infrastructure, creation values, typed confirmation/revision and no reset controls on live dealers.
- Intercepted Playwright checks at 390/820/1440 px: creation form/reset layouts, no horizontal overflow and no real writes.
- Real wildcard TLS/Clerk sign-in, real Resend delivery/webhook status and an actual Grok demo import still need operator configuration and controlled end-to-end testing.
