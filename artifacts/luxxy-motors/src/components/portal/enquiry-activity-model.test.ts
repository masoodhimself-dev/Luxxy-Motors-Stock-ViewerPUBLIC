import { expect, it } from "vitest";
import type { Enquiry } from "@workspace/api-client-react";
import {
  activityTimestamp,
  buildCaseActivity,
  caseEmailStatus,
  type CaseEmailRecord,
} from "./enquiry-activity-model";

const record = (id = "one", extra: Partial<Enquiry> = {}) =>
  ({
    id,
    reference: `ENQ-${id}`,
    customerName: "Alex",
    message: "Can I view the Golf?",
    createdAt: "2026-10-28T09:00:00Z",
    events: [],
    ...extra,
  }) as Enquiry;
const email = (key: string, extra: Partial<CaseEmailRecord> = {}) =>
  ({
    key,
    kind: "enquiry",
    enquiry_id: "one",
    subject: "Viewing details",
    status: "sent",
    created_at: "2026-10-28T10:00:00Z",
    message: "Your viewing details",
    ...extra,
  }) as CaseEmailRecord;
const note = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "conversation_logged",
  actor: "dealer",
  summary: "Call recorded",
  note: "Discussed the Golf",
  occurredAt: "2026-10-28T09:30:00Z",
  ...extra,
});

it("orders mixed channel timestamps by their actual instant and leaves undated current notes honest", () => {
  const items = buildCaseActivity(
    [
      record("one", {
        staffNote: "Current note",
        events: [note("call")] as Enquiry["events"],
      }),
    ],
    [
      email("later", { created_at: "2026-10-28 10:00:00+00" }),
      email("earlier", { created_at: "2026-10-28T10:15:00+01:00" }),
    ],
  );
  expect(items.map((item) => item.key)).toEqual([
    "email:later",
    "event:one:call",
    "email:earlier",
    "original:one",
    "internal:one",
  ]);
  expect(items.at(-1)).toMatchObject({
    title: "Current internal note",
    at: null,
  });
  expect(activityTimestamp("not a date")).toBe(0);
});

it("includes only journal records explicitly tied to the supplied case IDs", () => {
  const items = buildCaseActivity(
    [record()],
    [
      email("own"),
      email("other", {
        enquiry_id: "unrelated",
        recipient: "alex@example.com",
      }),
      email("not-linked", { enquiry_id: null, kind: "sale", sale_id: "sale" }),
    ],
  );
  expect(items.filter((item) => item.kind === "email")).toHaveLength(1);
  expect(
    items.some(
      (item) => item.key === "email:other" || item.key === "email:not-linked",
    ),
  ).toBe(false);
});

it("shows an incoming reply once while preserving repeated messages and separate call notes", () => {
  const mirrored = {
    actor: "customer",
    summary: "Customer email received",
    note: "Yes please",
  };
  const entry = record("one", {
    events: [
      note("mirror-1", mirrored),
      note("mirror-2", mirrored),
      note("real-call", { note: "Yes please" }),
    ] as Enquiry["events"],
  });
  const items = buildCaseActivity(
    [entry],
    [
      email("reply:1", {
        kind: "reply",
        message: "Yes please",
        status: "reply_needed",
      }),
      email("reply:2", {
        kind: "reply",
        message: "Yes please",
        status: "handled",
        created_at: "2026-10-28T11:00:00Z",
      }),
    ],
  );
  expect(items.filter((item) => item.kind === "customer-email")).toHaveLength(
    2,
  );
  expect(
    items.find((item) => item.key === "event:one:real-call"),
  ).toBeDefined();
  expect(items.find((item) => item.key === "email:reply:1")?.status).toBe(
    "Reply needed",
  );
  expect(items.find((item) => item.key === "email:reply:2")?.status).toBe(
    "Handled",
  );
});

it("does not deduplicate a different enquiry’s email mirror, or a reply whose body is unavailable", () => {
  const entries = [
    record("one", {
      events: [
        note("mirror", {
          actor: "customer",
          summary: "Customer email received",
          note: "Yes please",
        }),
      ] as Enquiry["events"],
    }),
    record("two"),
  ];
  expect(
    buildCaseActivity(entries, [
      email("reply:2", {
        enquiry_id: "two",
        kind: "reply",
        message: "Yes please",
      }),
    ]).filter((item) => item.kind === "customer-email"),
  ).toHaveLength(2);
  expect(
    buildCaseActivity(
      [entries[0]],
      [email("reply:3", { kind: "reply", message: null })],
    ).filter((item) => item.kind === "customer-email"),
  ).toHaveLength(2);
});

it("distinguishes confirmed WhatsApp from website taps without claiming delivery or read receipts", () => {
  const items = buildCaseActivity([
    record("one", {
      events: [
        note("sent", {
          summary: "WhatsApp sent — staff confirmed",
          note: "Here is the car link",
        }),
        note("tap", {
          kind: "whatsapp_intent",
          actor: "customer",
          summary: "WhatsApp clicked",
        }),
        note("call-tap", { kind: "call_intent", actor: "customer" }),
      ] as Enquiry["events"],
    }),
  ]);
  expect(items.find((item) => item.key === "event:one:sent")).toMatchObject({
    kind: "whatsapp",
    status: "Sent · staff confirmed",
    body: "Here is the car link",
  });
  expect(items.find((item) => item.key === "event:one:tap")).toMatchObject({
    title: "Customer opened WhatsApp",
  });
  expect(
    items.find((item) => item.key === "event:one:tap")?.status,
  ).toBeUndefined();
  expect(
    items.find((item) => item.key === "event:one:call-tap")?.caution,
  ).toContain("does not confirm");
});

it("keeps provider acceptance, unknown outcomes and tracking distinct from delivery", () => {
  expect(caseEmailStatus(email("sent"))).toBe("Submitted to email provider");
  expect(caseEmailStatus(email("unknown", { status: "unknown" }))).toBe(
    "Acceptance unconfirmed",
  );
  expect(caseEmailStatus(email("track", { last_event: "opened" }))).toBe(
    "Open tracking recorded",
  );
  expect(
    buildCaseActivity(
      [record()],
      [email("track", { last_event: "opened" })],
    ).find((item) => item.key === "email:track")?.caution,
  ).toBe("Tracking does not prove the customer read the email.");
});

it("keeps exact saved appointment events, but does not manufacture a historical booking event from current state", () => {
  const current = record("one", { appointmentAt: "2026-10-30T10:00:00Z" });
  expect(
    buildCaseActivity([current]).some((item) => item.kind === "appointment"),
  ).toBe(false);
  const items = buildCaseActivity([
    {
      ...current,
      events: [
        note("booked", {
          kind: "viewing_booked",
          summary: "Staff confirmed the test drive",
        }),
      ],
    } as Enquiry,
  ]);
  expect(items.find((item) => item.kind === "appointment")).toMatchObject({
    title: "Staff confirmed the test drive",
    at: "2026-10-28T09:30:00.000Z",
  });
});

it("deduplicates only record IDs and journal keys, retaining sale references and safe attachment counts", () => {
  const item = email("sale:one", {
    kind: "sale",
    sale_id: "sale-1",
    document_id: "invoice-1",
    subject: "Sales invoice INV-1",
    attachment_count: 1,
  });
  const items = buildCaseActivity([record(), record()], [item, item]);
  expect(items).toHaveLength(2);
  expect(items.find((item) => item.kind === "sale")).toMatchObject({
    saleId: "sale-1",
    title: "Sales invoice INV-1",
    attachmentCount: 1,
  });
});
