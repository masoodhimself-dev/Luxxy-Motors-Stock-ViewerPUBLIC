# Public enquiry retries: remaining reliability work

The customer cleanup improves the wording after an uncertain response: a network failure or HTTP 5xx no longer claims that the enquiry definitely failed to arrive. Part-exchange drafts survive refresh for 30 minutes in the same browser tab, and customers must review restored answers before sending. These changes do **not** make repeated public submissions idempotent.

## Why a separate backend change is needed

`POST /api/enquiries` currently saves the enquiry and lead, then records activity and sends notifications before returning the response. A response can be lost after the save. The next POST can create another enquiry, or a duplicate viewing attempt can be rejected as an occupied slot. The enquiry schema has no persisted public submission ID or original payload fingerprint. `visitorId` identifies a browser, not an individual submission, and must not be used as a substitute.

A process-memory cache would not protect multiple server instances or a restart. Existing stock-import, email and demo-onboarding retry records belong to different workflows and should not be reused for customer submissions.

## Proposed follow-up

1. Add a random public submission UUID to the API contract. The browser saves the UUID with the exact submitted payload before making its first request and retains it for an uncertain retry. An intentional new enquiry gets a new UUID.
2. Add a database receipt keyed by `(dealer_id, submission_id)`, with the original validated payload fingerprint and enquiry ID. Resolve the dealer from the request's trusted tenant context. An existing UUID with a different payload returns HTTP 409; an identical retry returns that dealer's existing receipt. Never search by the submission UUID across dealerships.
3. Reserve the receipt, create the enquiry and lead, and enqueue notification work in the same transaction. Retain the current vehicle visibility, appointment-capacity locks and validation. An already accepted replay is resolved before attempting to book its slot again.
4. Deliver notifications from a durable outbox with recorded provider outcomes. A replay must not send another customer/dealer email or record another lead event. An uncertain provider result needs an explicit reconciliation policy before another send.
5. Keep stored responses minimal and protect private appointment-management capabilities. Continue to validate that the retry matches the original payload before returning any existing customer response.
6. Update the isolated local preview and both general/part-exchange/booking clients together. Add bounded receipt retention that outlasts the browser's retry window, separately from the business record's retention.

Required tests: simultaneous identical requests create one enquiry/lead/outbox item; a lost response replays the same reference; changed-payload reuse fails; the same ID on another dealer cannot retrieve the first dealer's response; restart recovery remains correct; appointment capacity still holds; email and activity effects occur once; staff-created enquiries retain their existing explicit workflow.

This follow-up requires a reviewed schema migration and API/worker testing. No migration, live enquiry, provider email or deployment was performed during this customer cleanup.
