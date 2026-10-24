# Portal safe deletion — 24 October 2026

Status: implemented and tested on `codex/portal-safe-delete`. Not deployed. No migration, live deletion or customer communication was performed.

## Using the controls

- **Sales:** open an eligible saved draft, then use **Delete draft** at the bottom of its summary. The confirmation names the draft and initially focuses **Keep draft**.
- **Inbox:** open a clearly TEST-labelled enquiry, expand **Customer details & more**, then choose **Delete test enquiry**. The server checks linked records before enabling deletion. Staff must acknowledge that it is test data and press **Delete permanently**.
- Owners and sales staff with the existing `sales.manage` permission can use these controls. Accounts staff cannot delete records.
- Nothing sends automatically. These actions remove records; they do not mark a vehicle sold, release stock, cancel appointments or reverse money.

## What may be deleted

An unused sale draft may contain a selected car and asking price, but no real customer, payment, document or progressed sale activity. Clearly TEST-labelled drafts may contain test contact/delivery details only when the private saved request history proves the draft was a test throughout its lifetime. Clearing real details or renaming a real draft TEST does not make it eligible.

An enquiry needs a TEST prefix in both the original customer name and original message. For staff-created WhatsApp enquiries with the generated original message, the staff conversation must instead provide the explicit TEST evidence. This is not an arbitrary delete control for real enquiries. “Test drive buyer” and incidental mentions of testing do not qualify. Ordinary enquiry APIs cannot rewrite the original name/message to bypass this safeguard.

## Protection checks

The server refuses deletion when it finds issued documents, any payment history, sale/customer-access activity, source enquiries/reservations, linked stock ownership or sale follow-ups. Enquiry deletion additionally protects current/previous bookings, declarations, merges, progressed leads, incoming/customer messages, real staff notes, email sends/attempts/replies/routes/outbox, invoice attachments and non-test sharing links.

Eligible enquiry deletion removes only that test enquiry and its safe dependent test data, including an untouched automatically opened TEST lead. Exact test-only phone sharing links are revoked and their payloads cleared. Pending test push work is cancelled; AI usage accounting survives. It never deletes a customer-table record or other enquiries merely because their name, phone or email matches.

Both operations check the current revision in a transaction. Existing dealer advisory locks and row locks prevent races with sales, merges and sharing. Phone-share creation now rechecks its enquiry under the sharing lock, preventing a capability from being inserted after its enquiry was deleted. A failed/uncertain request is not automatically retried. The UI requires a fresh review after a conflict.

## API additions

| Method | Path | Contract |
| --- | --- | --- |
| DELETE | `/api/sale-workspace/:id` | `{expectedRevision, confirm: true}`; only eligible unused/test drafts; returns `{deleted:true,id}`. |
| GET | `/api/staff/enquiries/:id/deletion` | Returns `{id,expectedRevision,canDelete,reason}` with `Cache-Control: no-store`. |
| DELETE | `/api/staff/enquiries/:id/deletion` | `{expectedRevision,confirmTestOnly:true}`; protection checks repeated; returns `{deleted:true,id}`. |

The sale list/get/mutation projection includes a server-computed `emptyDraftDeletable` flag. Private retry ledgers, provider state and archived document bytes remain excluded from staff responses. No schema changes were needed.

## Verification

- Workspace TypeScript checks passed.
- Full frontend suite: **185 files, 1,920 tests passed**, with `NODE_OPTIONS=--no-experimental-webstorage` and `--maxWorkers=2`.
- New isolated PostgreSQL/HTTP deletion tests: **17 tests passed**, with additional guarded scenarios within the sale tests. These apply actual migrations to fictional PGlite databases; they never connect to a live database.
- Existing sales regression suites: **88 tests passed** across invoice settings, A4 PDFs, sale calculations/workspace, connected store, previews, HTTP flows and invoice verification.
- Existing media sharing: **38 tests passed**. Customer reply routing: **12 tests passed**.
- Browser end-to-end: **6 tests passed**, covering both flows at **390, 834 and 1440px**, with actual Chrome and fictional intercepted API responses. Checked cancellation, exact ID/revision/confirmation payloads, route/cache removal, preservation of a real record sharing the same contact details, no extra writes/messages, no page errors and no horizontal overflow.
- Production frontend and API builds passed. Frontend still reports its existing large-bundle warning.
- Independent backend review checked tenant/role boundaries, foreign keys, JSON references and lock ordering. Production PostgreSQL concurrency and real iOS/Android hardware were not exercised.

The first unrestricted frontend run exhausted the local test runner's useful concurrency and produced timing failures. The complete rerun at two workers passed without changing application behaviour or loosening assertions. Existing backend mocks were updated to distinguish the new eligibility query from replay lookups; invoice privacy test expectations were aligned with the already-existing stronger `noarchive`/`no-store` HTML headers. No invoice/privacy behaviour was changed for those test corrections.

Visual verification found and fixed the sale confirmation being painted behind the fullscreen sales workspace. Its dialog and overlay now render above that workspace; the browser regression checks the stacking order.

## Screenshots

All screenshots show fictional local records.

| Size | Enquiry confirmation | Sale confirmation |
| --- | --- | --- |
| Phone, 390px | [Enquiry](screenshots/portal-safe-deletion-2026-10-24/luxxy-safe-delete-enquiry-390.png) | [Sale](screenshots/portal-safe-deletion-2026-10-24/luxxy-safe-delete-sale-390.png) |
| Tablet, 834px | [Enquiry](screenshots/portal-safe-deletion-2026-10-24/luxxy-safe-delete-enquiry-834.png) | [Sale](screenshots/portal-safe-deletion-2026-10-24/luxxy-safe-delete-sale-834.png) |
| Desktop, 1440px | [Enquiry](screenshots/portal-safe-deletion-2026-10-24/luxxy-safe-delete-enquiry-1440.png) | [Sale](screenshots/portal-safe-deletion-2026-10-24/luxxy-safe-delete-sale-1440.png) |

No automated undo is introduced. A blocked record is retained with its protection reason. Any later release should deploy the code only; existing dealership data and messages remain unchanged until an authorised staff member explicitly deletes an eligible test/empty record.
