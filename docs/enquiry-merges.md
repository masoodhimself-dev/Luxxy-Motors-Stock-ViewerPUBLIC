# Enquiry and test-drive cases

Staff with `sales.manage` can combine enquiries and test-drive bookings into one case. The main enquiry represents the case in the desk. Every original remains available inside the case, keeps its own vehicle, customer, message, dated discussions, follow-up, appointment and customer management link, and remains editable using the existing staff actions. This does not merge sales, payment reservations or chat conversations, or rewrite the original customer identity/contact values. Customer history can group explicitly combined originals while retaining their separate contact details and source records.

The staff calendar continues to show each original appointment explicitly kept during the merge. Separate appointments can all be kept. Staff must choose the exact appointments to keep and review cancellations before submitting; omitted active appointments are cancelled on their original rows. A historical appointment that has not been cancelled is also included in this choice. Cancellation increments that appointment revision and stops its scheduled reminder; previous appointment and reminder history remain stored.

## API

`POST /api/staff/enquiries/:id/merge` uses the path ID as the main record. The required body is:

```json
{
  "recordIds": ["main-record-uuid", "other-record-uuid"],
  "expectedRevisions": [
    { "id": "main-record-uuid", "workspaceRevision": 0, "appointmentRevision": 0, "followUpRevision": 0 },
    { "id": "other-record-uuid", "workspaceRevision": 0, "appointmentRevision": 0, "followUpRevision": 0 }
  ],
  "keepAppointmentIds": ["other-record-uuid"],
  "reason": "Customer called about two cars",
  "confirmDifferentCustomers": false,
  "allowOverlappingAppointments": false
}
```

IDs must be real UUIDs. Select between two and twenty originals, including the main record. If selecting an existing case, include its main record and every original; the server flattens both groups to the chosen main record. A merged child cannot become the new main record. Missing parents, incomplete groups and cycles are rejected. Records already in one case cannot be merged again without another case.

The server requires current workspace, appointment and follow-up revisions for every original. An intervening staff conversation, customer chat/contact update, status change, follow-up, appointment change, or merge returns `409` and requires a refresh. Kept appointments can overlap only with explicit confirmation; occupied intervals include duration and buffer, with existing defaults of thirty minutes and zero buffer. Matching names alone never establish customer identity. Every pair must share a canonical phone or email and have the same normalized name, or staff must explicitly confirm that potentially different customers should be combined. UK `0`, `+44`, `0044`, and twelve-digit `44` telephone forms compare consistently.

The response is `{ "primaryId": "…", "recordIds": ["…"], "cancelledAppointmentIds": ["…"] }`. Refetch enquiry and appointment lists after success. Enquiry responses expose optional `mergedIntoId`, `mergedAt` and `mergedBy`; older records with absent fields are unmerged.

All selection reads are scoped to the dealership, existing members are locked, and membership updates plus one `records_merged` audit event per original commit in one transaction. Each audit event stores the reason, staff identity, former parent, complete membership, exact kept and cancelled appointments, and explicit confirmations. Nothing rewrites or moves customer fields, messages, earlier events, sale/lead relations, chat tokens or appointment management tokens. No customer email or external provider call is made during a merge.

## Local preview and deployment

The preview uses the existing authorized localhost/LAN and origin checks, active preview staff accounts, and `sales.manage` permission. `x-preview-staff-id` chooses the preview staff identity under the existing local convention. Its serial persistence queue saves all affected originals and audit events together and rejects a competing stale merge. This module is not imported by the production entry point.

Migration `lib/db/drizzle/0020_enquiry_merges.sql` adds nullable membership and audit fields, a parent foreign key and index, a self-parent check, and the new event kind. Its journal and schema snapshot are included. **The migration has not been applied to any database.** Apply it through the established deployment migration process before rolling out the new API code. Existing rows remain unmerged; there is no automatic data reconciliation or customer matching.

## Isolated validation

`pnpm --filter @workspace/api-server run test:enquiry-merges` runs the pure planner, production-route fixture driver and durable-preview tests. The fixture driver forbids real database queries. The preview tests use temporary files and simulated HTTP requests, including concurrent merges, role/origin rejection, original customer links, kept/cancelled appointments, group flattening, preserved history, and child editing. No real records, live API, customer notifications or payment/email providers are contacted.
