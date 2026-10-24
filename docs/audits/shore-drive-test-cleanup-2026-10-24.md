# Shore Drive test cleanup — 24 October 2026

Status: completed. The user gave final confirmation, the guarded transaction committed, and the live portal was checked afterwards.

## Exact scope

- Empty draft `db1d8e1b-b094-4118-90f4-06417f72b6ec`, revision 2, `TEST — WhatsApp delivery check 24 Oct`. Zero payments/documents, no completion, reservation, source enquiry/reservation or customer access.
- Test enquiry `ef7b8c61-a7f8-4ef9-ac4f-389f8434452d`, revision 1, same test label. Its only referencing row is the test delivery conversation below.
- Invoice test message `c8ec8089-2495-4349-8398-233cadbadccd` on **retained real** enquiry `adeda205-e6e0-4cbb-bf13-9c887db1af30` (Masood/Mercedes). Exact explicit TEST marker and no-actual-send wording were checked.
- Delivery test message `bb92d1a9-6e34-420d-825e-3cc092a9bf6b` on the test enquiry. Exact explicit TEST marker and no-actual-send wording were checked.
- Four private sharing packs from that specific test session: `4dca0acd-f4ee-44ef-b7bb-deb4cbf59b16`, `d3e63f1a-0ca3-45c1-b98b-3d3512781c85`, `23fbb922-b073-4113-ae2c-8053a26dcbb4`, `a8159ead-b40a-4e66-b833-67f96e709f89`. Original/edited packs were identified by exact IDs, creator, creation times, expected vehicle/enquiry, message proof and PostgreSQL payload hashes. Only these links are proposed for revocation; issued invoices remain unchanged.

No broad deletion by phone, email, date range or a TEST-name pattern will be performed. The draft counter and real enquiry revision will not be reset.

## Access and guards

There is no normal delete API/UI for drafts, enquiries or individual messages. The database blocks external connections. Its allowlist was not widened, and no new credentials were created. Existing signed-in Render Web Shell provides the internal connection through the service's private `DATABASE_URL`; no credential values were printed or copied.

Standalone script: local/service `/tmp/shore-cleanup-guarded.cjs`. Default mode starts a read-only transaction and checks exact labels/revisions/IDs, all target fingerprints, absence of payments/documents/completion and all referencing records. It checks 15 foreign keys and snapshots hashes/counts for all 47 public dealer-scoped tables, excluding only the exact cleanup targets.

The preview passed, with one expected dependent test event and no unexpected dependencies. Target fingerprint: `f84c83cebbe358eac33452c7ce7b523c4847cc0bd0945704e41df224b4be52a8`. Private 0600 plan: service `/tmp/shore-drive-test-cleanup-plan-2026-10-24.json`.

Apply requires explicit `--apply-confirmed`, an unchanged target fingerprint/scope, a fresh plan, row locks and the normal dealer sales advisory lock. It creates a private 0600 exact-row recovery file in the service's temporary filesystem, deletes only the two messages/one draft/one enquiry, revokes only four links and clears their payloads, and compares every protected dealer table before committing. Any unexpected change rolls back. This temporary row backup is not a durable database export or a portal undo facility.

Verification of script preparation: syntax passed; valid synthetic fixture accepted and 12 unsafe mutations rejected; Date fingerprints checked. The first read-only preview safely rolled back on PostgreSQL `name[]` parsing; casting catalog arrays to `text[]` resolved it. The second read-only preview passed. No application code, deployment, database schema, network access, payment, invoice or customer message sending configuration changed.

Final confirmation was requested because browser safety policy requires confirmation at the action time for permanent deletion; this is not a Render skill requirement. Evidence: `/tmp/shore-drive-test-cleanup-preview-2026-10-24.png`.

## Completion

After the user answered “Confirm test-only cleanup”, the prepared script ran with `--apply-confirmed` in the same internal service shell. It committed exactly:

- 1 empty test draft removed.
- 1 test enquiry removed.
- 2 explicitly labelled test conversation events removed.
- 4 exact test sharing links revoked and their attachment/message payloads cleared.

All 47 protected dealership tables had identical before/after hashes and counts. The private row recovery file was created before mutation; the private completion receipt is `/tmp/shore-drive-test-cleanup-result-2026-10-24.json` on the service instance. No counters or real enquiry revision were reset.

Live verification after a fresh reload:

- Sales lists only the retained Masood/Mercedes sale; the test draft is absent.
- Real customer `adeda205-e6e0-4cbb-bf13-9c887db1af30` still opens, retains the Mercedes and prior real conversation, and no longer shows the invoice test message. Its conversation count returned from two to one.
- The retained sale is still sold, agreed/paid £4,191, balance £0, with the same £200 cash and £3,991 bank-transfer entries, full invoice `INV-2026-00002`, two saved paperwork items and original collection/to-arrange state.
- Opening the previously working invoice test attachment link now shows “This sharing link expired or was revoked. Ask staff for a new link.” No invoice itself was deleted or reissued.
- The tab displaying the deleted test enquiry was closed so it does not leave a stale test view open.

Evidence: `/tmp/shore-drive-clean-sales-2026-10-24.png` and `/tmp/shore-drive-test-cleanup-committed-2026-10-24.png`. No customer messages, deployment, migration or application-code changes were made during cleanup.
