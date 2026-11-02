import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import type { Enquiry } from "@workspace/api-client-react";
import { handlePreviewBooking, type BookingPreviewState } from "./reservations";
import { previewSettings } from "./settings";

const id = "00000000-0000-4000-8000-000000000001",
  other = "00000000-0000-4000-8000-000000000002";
const entry = (changes: Partial<Enquiry> = {}) =>
  ({
    id,
    dealerId: "local-preview",
    customerName: "Synthetic local buyer",
    message: "Original question",
    staffNote: "Private note kept",
    status: "new",
    workspaceRevision: 3,
    appointmentAt: null,
    followUpAt: null,
    events: [],
    ...changes,
  }) as Enquiry;
const state = (changes: Partial<Enquiry> = {}): BookingPreviewState => ({
  reservations: [],
  enquiries: [
    entry(changes),
    entry({
      id: other,
      mergedIntoId: id,
      appointmentAt: "2099-01-01T10:00:00Z",
      type: "viewing",
      appointmentStatus: "pending",
    }),
  ],
});
const staff = [
  { id: "preview-alex", name: "Alex", role: "salesperson" as const },
  { id: "preview-accounts", name: "Accounts", role: "accounts" as const },
];
async function call(
  current: BookingPreviewState,
  input: unknown = { expectedRevision: 3, status: "closed" },
  staffId = "preview-alex",
) {
  const request = Readable.from([JSON.stringify(input)]) as IncomingMessage;
  request.method = "POST";
  request.headers = { "x-preview-staff-id": staffId };
  return handlePreviewBooking(
    request,
    new URL(`/api/staff/enquiries/${id}/resolution`, "http://localhost"),
    current,
    previewSettings,
    { readMergeStaff: async () => staff },
  );
}
test("local resolution closes only its selected in-memory record and keeps an audited, idempotent result", async () => {
  const current = state(),
    linkedBefore = JSON.stringify(current.enquiries![1]);
  const result = await call(current);
  assert.equal(result?.status, 200);
  assert.deepEqual(result?.data, {
    id,
    status: "closed",
    workspaceRevision: 4,
    updatedAt: current.enquiries![0].updatedAt,
    changed: true,
  });
  assert.equal(current.enquiries![0].message, "Original question");
  assert.equal(current.enquiries![0].staffNote, "Private note kept");
  assert.equal(JSON.stringify(current.enquiries![1]), linkedBefore);
  assert.equal(current.enquiries![0].events[0].summary, "Enquiry marked done");
  assert.equal(current.enquiries![0].events[0].staffId, "preview-alex");
  const repeated = await call(current, {
    expectedRevision: 4,
    status: "closed",
  });
  assert.equal((repeated!.data as { changed: boolean }).changed, false);
  assert.equal(current.enquiries![0].events.length, 1);
});
test("preview refuses active appointments, outstanding follow-ups, stale revisions and seeded reply attention without changing any fixture", async () => {
  for (const changes of [
    {
      appointmentAt: "2099-01-01T10:00:00Z",
      type: "viewing",
      appointmentStatus: "pending",
    },
    { appointmentAt: "2020-01-01T10:00:00Z", attendance: "scheduled" },
    { followUpAt: "2099-01-01T10:00:00Z" },
    { workspaceRevision: 4 },
    { pendingEmailReplies: 1 },
    { emailRepliesToReview: 1 },
  ]) {
    const current = state(changes as Partial<Enquiry>),
      before = JSON.stringify(current);
    await assert.rejects(
      call(current),
      (error) => (error as { status: number }).status === 409,
    );
    assert.equal(JSON.stringify(current), before);
  }
  for (const changes of [
    { appointmentAt: "2020-01-01T10:00:00Z", attendance: "completed" },
    {
      followUpAt: "2020-01-01T10:00:00Z",
      followUpCompletedAt: "2020-01-01T11:00:00Z",
    },
  ])
    assert.equal((await call(state(changes as Partial<Enquiry>)))?.status, 200);
});
test("preview validates permission, dealership and strict close-only input using injected staff only", async () => {
  const current = state(),
    before = JSON.stringify(current);
  await assert.rejects(
    call(current, undefined, "anonymous"),
    (error) => (error as { status: number }).status === 401,
  );
  await assert.rejects(
    call(current, undefined, "preview-accounts"),
    (error) => (error as { status: number }).status === 403,
  );
  for (const input of [
    { expectedRevision: 3, status: "new" },
    { expectedRevision: 3, status: "closed", force: true },
    { expectedRevision: -1, status: "closed" },
  ])
    await assert.rejects(
      call(current, input),
      (error) => (error as { status: number }).status === 400,
    );
  assert.equal(JSON.stringify(current), before);
  const foreign = state({ dealerId: "other-dealer" }),
    foreignBefore = JSON.stringify(foreign);
  await assert.rejects(
    call(foreign),
    (error) => (error as { status: number }).status === 404,
  );
  assert.equal(JSON.stringify(foreign), foreignBefore);
});
