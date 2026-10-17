# Customer emails from enquiries

Owners and salespeople can select a saved enquiry and choose **Email customer**. Accounts staff cannot send enquiry emails.

## Staff workflow

1. Check the prefilled recipient. A one-off recipient can be entered without changing the enquiry's stored contact details.
2. Edit the subject and message. The owner's **Customer message from enquiries** template supplies the initial wording; shared email branding is retained.
3. Choose optional vehicle and appointment information. Current cash price, plate or existing registration label, supplied facts, availability and appointment status come from the server. Unapproved appointments are never described as confirmed.
4. Inspect and optionally select up to three private service-book photos. Upload them under **Cars → select the car → Upload from phone**. Each stored JPEG is at most 500 KB, with metadata removed, separate from the public imported gallery. Check personal information visible within pages before sending.
5. Choose **Review email**, inspect the message and attachment filenames, then **Send email**.
6. Read the result. **Submitted to Resend** means provider acceptance, not delivery or a read receipt. The enquiry history and recent-email list record the outcome.

The owner's Resend connection must be configured, enabled and use an appropriate verified sender. Preparation and review never send email. Disabled delivery permits review but prevents sending.

## Contract and safeguards

- `GET /api/staff/enquiries/:id/email-context`: defaults, readiness, photo metadata and recent delivery results; no secrets or photo bytes.
- `POST /api/staff/enquiries/:id/email-preview`: renders the selected facts and returns a SHA-256 preview identity; never contacts Resend.
- `POST /api/staff/enquiries/:id/email`: **an actual customer-email write**, requiring the reviewed identity and UUID request ID.

Draft fields are `to`, `subject`, `message`, `includeVehicle`, `includeAppointment`, `photoIds` and `expectedRevision`. Sending adds `requestId` and `previewHash`. Invalid fields/addresses, duplicate photo IDs, multiline subjects and excessive text are rejected. Staff identity, sales-management permission and dealer context protect every route. Same-dealer origin checks permit verified aliases and reject unrelated origins.

Every photo query binds dealer, enquiry vehicle and photo ID. The backend rechecks current rendered facts and exact photo contents: changed/deleted photos, prices or appointment information require a new review. Staff text is escaped literally, including HTML and template-looking braces. Per-enquiry locking and a durable unique delivery journal prevent concurrent or identical retries from sending twice; changed-content request reuse is rejected.

The approved provider envelope is saved in a tenant-bound outbox before sending. Definite temporary provider rejections are retried with the same bytes and idempotency key, at most three provider attempts and only within 23 hours. The queue respects `Retry-After`; local capacity deferrals do not consume a provider attempt. Pending retries show **Retry scheduled**, with a **Refresh saved status** action that only reads the journal. It never creates another send.

Uncertain acceptance, including a timeout, lost connection or an expired in-flight lease after a restart, becomes **acceptance unconfirmed** for operator review. It is never blindly resent. Every queued retry rechecks the staff approval, current customer/car/appointment facts, attachments, sender and provider account; changed details require a new review. Permanent provider rejection becomes **not sent**. An enquiry allows 20 new requests per hour; identical request retries read the existing journal and do not count again.

Migration `0041_email_outbox.sql` creates the outbox without re-sending old failures or backfilling old messages. Older abandoned **sending** records without an approved outbox snapshot are marked unconfirmed, rather than resent. The existing confirmation/reminder paths use the same bounded retry mechanism for new messages. A targeted sweep finds due dealers instead of repeatedly scanning every dealer's history. The provider transport and message preparation each admit at most two active operations per API process, with no in-memory queue of attachment payloads.

Terminal outbox transport copies (including attachment bytes) are cleared after 48 hours in small batches. The delivery journal, original invoice archives, payment records and customer history follow their existing retention rules. No provider API key is stored in the outbox; its account binding is a one-way fingerprint.

Migration `0023_enquiry_emails.sql` adds the delivery journal and supporting composite enquiry/dealer key. No stock, payments, issued documents or customer records are replaced. Email content and recipient history are private dealer records. Attachment bytes are not duplicated in the permanent journal.

## Verification and local preview

Isolated PostgreSQL/PGlite tests use two fictional dealers and an injected recording provider. Coverage includes permissions, aliases/origins, photo scope, literal escaping, changed previews, concurrent/exact retries, disabled delivery and rejected/uncertain provider responses. Browser checks cover phone/tablet/desktop composition, attachments, lost-response retry and stale-preview recovery. Phone email and QR-upload checks remove `crypto.randomUUID` to exercise the secure HTTP LAN fallback.

No test sends real customer email. The fixture-only local preview has no persistent email/photo storage; actual delivery requires the authenticated API and a configured dealer Resend connection.
