# Demo-to-live dealership conversion

Platform → select dealership → Demo → **Review live conversion**.

The operator promotes the existing tenant. Its internal ID can still start with `demo-`; that string is not an access or lifecycle flag. Its stock-import path, credential, cache identity and source retailer stay unchanged. No Grok schedule, external DNS record, Render domain, Clerk account or Resend configuration is created by this operation.

## Prepare and review

1. Agree the launch with the dealer. Finish practice actions and pause the dealer's Grok worker for cutover.
2. Add the real domain under Domains, publish its ownership TXT record and verify it. Connect it to the existing Render service and test HTTPS and Clerk sign-in. The shared demo domain cannot be the live origin.
3. Assign the dealer's own existing Clerk account as an active owner through the dealer portal. Platform administrator access remains separate; the seeded platform owner's membership alone is insufficient.
4. In dealer Settings replace the demo contact email, confirm phone/showroom address, review branding and approve real sales terms/invoice references.
5. Store the dealer's own Resend key and verified live sender in secure integration settings. Shared demo credentials/senders are rejected. Verify the provider sender/reply-to and delivery manually and complete the launch checklist. While the tenant is still a demo, ordinary website email tests intentionally use demo protections; these are not proof of the live sender. Provider-side live sender verification/testing is separate. No live sender is automatically tested by conversion.
6. Leave Stripe and online reservations disabled for cutover. Enable payments separately after live testing. If online test drives are enabled, test the booking rules and mark that launch item complete.
7. Require a saved demo baseline, a complete non-empty stock import collected within 24 hours and an active dedicated import credential. Finish any queued demo completion job.
8. Complete the existing Setup confirmations: business, HTTPS, owner login, branding, terms, email, email test and dealer launch approval. These are explicitly operator attestations, not automatic external verification.
9. Open **Review live conversion**, choose a verified real domain and refresh. The server returns individual readiness checks and blockers; no secret values are exposed.

## Final action

The operator checks the practice/worker/cleanup acknowledgement and types the exact internal dealer ID. The button remains disabled until readiness passes. The server rechecks readiness inside the transaction, using the current demo revision, existing import/sales/settings locks, locked domain/staff/settings rows and the operator's existing platform authorization.

Only recognised seeded fictional enquiries, leads and sales are removed. Existing provider payments, manual staff ledger activity, issued archives/customer access links, ordinary customers, conversations or ambiguous records block conversion for review. A `SAMPLE-SALE` reference alone is not enough to authorize deletion: payment/event/document provenance must still match the fictional seed. The general-purpose demo reset helper is not used by conversion.

The transaction:

- Deletes only the recognised sample IDs and their dependent history; removes their practice invoice counters and the saved reset baseline.
- Releases only sample-owned reserved vehicle flags. It does not turn all stock available: unrelated sold/archived/reserved states, prices, source facts, images, service/pre-accident photographs and preparation data remain.
- Preserves staff memberships, encrypted private integration settings, vehicle IDs, import history, source connection and dedicated stock credential.
- Sets the selected verified live canonical origin; rewrites retained platform logo URLs and preserves the illustrative hero when no custom hero was configured.
- Disables the old shared demo subdomain mapping; a real customer website is not left accessible under the public demo alias.
- Marks the retained demo row converted with operator/time/receipt. Logos remain stored there, but expiry, sample branding, forced test-recipient redirection, demo noindex and reminder/payment overrides no longer apply.
- Rejects subsequent demo resets and machine onboarding/edit/completion/baseline operations on that live tenant. Stale demo-context email or sale operations fail and require a reload.

An identical confirmation retry returns `replayed`, with no repeat deletion. Reusing conversion to change a now-live domain returns 409. A failed transaction rolls everything back. There is no automatic reversal to a demo after conversion; original fictional activity and the starting point are deliberately removed. Finish active staff requests before pressing the button: this is not a global browser/worker pause mechanism.

## Operator API

Protected by the existing platform hostname, Clerk platform-admin and origin guards (not the onboarding machine secret):

- `GET /api/platform/dealers/:id/conversion?origin=<optional-approved-https-origin>` — read-only. Returns demo/converted flags, revision, eligibleOrigins, chosen domainOrigin, checks, ready and blockedReasons.
- `POST /api/platform/dealers/:id/conversion` — **WRITE / fictional cleanup and live activation**:

```json
{"expectedRevision":1,"confirm":"demo-fictional-motors","acknowledge":true,"domainOrigin":"https://fictional-motors.example.test"}
```

Use actual values from the review. Responses: 200 converted/replayed; 400 invalid confirmation; 403 unauthorized platform caller; 404 unknown dealership on read; 409 failed checks/stale revision/already regular or conflicting retry; 503 transaction failure with no partial cleanup committed. No secret is issued, rotated or returned.

## After conversion

Open the real domain and portal, test enquiries, bookings, invoices and actual email delivery using approved test recipients. Review legal/contact data. Tell the dealer bot the existing ID, endpoint and credential remain; review its demo-only configuration (such as OCR and delivery disabled). Run an approved fresh import and identical replay. Enable twice-daily deliveries only on separate operator approval. Conversion itself never starts a schedule or charges a subscription. Billing remains separate.

## Verified in this release

Isolated database/migration tests cover blockers, stale revisions, authorization, real-looking manual/provider payment rejection, rollback after late failure, sample-only cleanup, preserved sold stock/prices/credentials, rewritten logo/hero links, disabled old domain, idempotent retry and denial of bot/reset operations afterward. Runtime tests cover retained logos, formerly expired converted dealers, normal email routing, non-sample future documents, background eligibility and stale-demo failures. UI tests cover readiness loading, blockers, domain selection, exact typed confirmation, acknowledgement, successful refresh and error recovery.

No real dealership was converted during development. Real DNS/HTTPS, live sender verification and the first actual dealer cutover still require operator checks and final approval.
