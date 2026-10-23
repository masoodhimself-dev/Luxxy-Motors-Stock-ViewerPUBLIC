# Post-sale Google review reminders

Implemented on `codex/sale-review-reminders`. Deployed to Render on 23 October 2026; no live buyer records or outgoing review messages were created during release verification. No database migration is needed.

## Staff flow

After completing/marking a sale sold, the final screen and saved sale summary offer an optional review reminder. It starts unchecked. Staff choose a UK date/time (default one week later at 10:00), paste the dealership’s Google review link, and explicitly save. A previous sale’s link can be suggested within the same dealership. Nothing is sent automatically.

The reminder creates one dedicated post-sale buyer enquiry with the exact saved customer contact and car, plus a normal follow-up. When due, Home labels it “Google review request”. Staff open the existing email composer, review/edit neutral wording requesting an honest review, then use the existing preview/send process. The email excludes current price and appointment facts by default. Existing saved drafts retain priority. Staff mark the follow-up complete in the enquiry after contacting the customer. Reminders can be rescheduled or cancelled from the sale.

No rating, incentive, positive-only filter or review gating is introduced. A valid customer email and HTTPS Google-domain link are required. Staff should check the link opens the correct business; it is not fetched or automatically verified.

## Persistence and API

`POST /api/sale-workspace/:id/review-reminder`, staff with `sales.manage`:

```json
{"requestId":"unique-retry-id","expectedRevision":4,"at":"2026-10-30T10:00:00.000Z","url":"https://g.page/r/example/review"}
```

Cancellation uses `cancel: true` with the normal request ID and expected sale revision. Standard response contains the updated sale and replay status. Sale JSON records reminder metadata; the existing enquiries table holds its follow-up. Production saves both in the same transaction under existing dealer/row locks. Same-request retries do not create duplicate customer records or resend anything. Reminder mutations do not call stock actions or rewrite any document archive, invoice snapshot, payment or agreed price. Preview-only counterparts support local testing without email transport.

## Validation

- 113 frontend component/unit tests passed across sales, reminder, email composer, Home, enquiry presentation and history.
- 32 sale-workspace tests passed, including post-sale gating, future date and Google URL validation, no-email guard, idempotency, rescheduling and immutable financial records.
- 34 isolated database/HTTP media and sharing tests passed, including actual review reminder persistence, buyer identity, due Home task, review email defaults, cancellation and dealer isolation with no send.
- 3 real Chrome browser scenarios passed at 390, 834 and 1440 pixels; reviewed screenshots confirm wrapping and no horizontal overflow.
- Workspace typecheck and production build passed. Existing build warnings about bundle size and sourcemaps remain.

Actual delivery from a dealership and physical iPhone/iPad behavior remain unverified for this new feature; no real review invitation was sent. The normal existing email permission/configuration checks still apply.

## Render release verification

Commit `06b70e14283230036c4ebbc03bd78d0ccdc1a586` deployed successfully through `dep-dbdndm1srm7s73cbpqtg` on the existing shared service. Render reported live; Shore Drive health returned `status: ok`, and the initial error-level app log query contained no entries. No new migration, credentials or environment changes were required.

Opened the existing completed Shore Drive sale in the signed-in browser. Verified the reminder is unchecked by default. Toggling it locally exposed the 30 October 2026 10:00 UK default, Google review URL input and disabled Save until a link is supplied. Checked live layouts at 390 and 834 CSS pixels with no horizontal overflow. Returned the checkbox to unchecked and restored the viewport. No reminder was saved, no buyer enquiry was created, no Google link was fabricated, and no review email was sent.

Staff must explicitly save a reminder and later review/send the email through the normal composer. Deployment does not enable automatic review sending. The full reminder persistence/send-preview flow remains covered by the isolated tests; physical iPhone/iPad testing is for the operator.

## Shared dealership review-link change (local, not deployed)

Branch `codex/dealership-review-link` moves the URL to `contact.googleReviewUrl`, edited once in Settings → Dealership details → Contact & hours. Use the normal Review changes / Publish showroom workflow. The optional schema field requires no migration and remains dealer-scoped. Publication validates a Google HTTPS URL; omission by an older client preserves the existing link, while an explicit empty string clears it.

Sale screens read the current dealership setting, show a read-only check link and collect only the reminder date/time. Missing settings provide an owner-Settings link instead of a per-sale URL input. The reminder endpoint ignores any per-sale URL supplied by a client, and sale assets read the authoritative dealership setting. The saved reminder retains its approved URL; previously reviewed drafts and existing reminder snapshots are not silently rewritten. Retry identities stay stable even if settings change. Sending remains staff-reviewed and manual.

The new scheduling request is `{requestId, expectedRevision, at}`; cancellation remains unchanged. Pure model tests retain legacy internal URL inputs for compatibility but production requests always use the loaded dealership setting.

Validation: 50 frontend settings/reminder/sales checks, 33 sale-workspace checks, 14 settings contract/compatibility checks, 34 isolated sharing/HTTP/database checks and 3 responsive browser scenarios. The workspace build and typecheck passed. No real review email was sent and no live settings were edited.
