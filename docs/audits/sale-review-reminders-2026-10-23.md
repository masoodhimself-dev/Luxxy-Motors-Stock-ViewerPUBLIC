# Post-sale Google review reminders

Implemented on `codex/sale-review-reminders`. Not deployed; no live buyer records or outgoing messages were created for this feature. No database migration is needed.

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
