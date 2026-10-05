import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DealerChatService,
  MemoryChatStore,
  type ChatDealer,
  type ChatEnquiryInput,
  type ChatStore,
} from "../../api-server/src/lib/dealer-chat";
import { chatPreview, PreviewChatStore, readPreviewChatRecords } from "./chat";
const customer = { name: "Amy", email: "amy@example.test" };
const dealer: ChatDealer = {
  identity: { name: "Isolated test showroom" },
  hours: [{ days: "Monday-Friday", times: "09:00-18:00" }],
};
function service(store: ChatStore = new MemoryChatStore()) {
  return new DealerChatService(store, {
    dealerId: () => "local-preview",
    dealer: async () => dealer,
    vehicle: async () => null,
    staff: async () => [{ id: "owner", name: "Alex" }],
    now: () => new Date("2026-10-05T10:00:00Z"),
  });
}
function request(
  options: {
    method?: string;
    body?: unknown;
    remote?: string;
    host?: string;
    origin?: string;
    staff?: string;
    token?: string;
  } = {},
): IncomingMessage {
  return {
    method: options.method ?? "GET",
    socket: { remoteAddress: options.remote ?? "127.0.0.1" },
    headers: {
      host: options.host ?? "localhost:4175",
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.staff ? { "x-preview-staff-id": options.staff } : {}),
      ...(options.token ? { "x-chat-token": options.token } : {}),
    },
    async *[Symbol.asyncIterator]() {
      yield JSON.stringify(options.body ?? {});
    },
  } as unknown as IncomingMessage;
}
function response() {
  const headers = new Map<string, string>();
  const state = { status: 0, body: "" };
  const res = {
    statusCode: 0,
    setHeader(name: string, value: string | number) {
      headers.set(name.toLowerCase(), String(value));
    },
    end(value: string) {
      state.status = this.statusCode;
      state.body = value;
    },
  } as unknown as ServerResponse;
  return { res, state, headers };
}
const staff = async () => [
  { id: "owner", name: "Alex", role: "owner" as const },
  { id: "sales", name: "Jamie", role: "salesperson" as const },
];
test("preview network, origin and staff access guard reads, writes and unsupported methods", async () => {
  const isolated = service();
  for (const options of [
    { remote: "203.0.113.5" },
    { host: "foreign.example" },
    { origin: "https://foreign.example" },
  ]) {
    const result = response();
    await chatPreview(
      request(options),
      result.res,
      new URL("http://localhost/api/chat/config"),
      { service: isolated, staff },
    );
    assert.equal(result.state.status, 403);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  for (const method of ["GET", "POST", "DELETE"]) {
    const result = response();
    await chatPreview(
      request({ method, staff: "disabled" }),
      result.res,
      new URL("http://localhost/api/staff/chat/conversations"),
      { service: isolated, staff },
    );
    assert.equal(result.state.status, 401);
  }
  const forbidden = response();
  await chatPreview(
    request({ staff: "sales", method: "PATCH", body: { enabled: false } }),
    forbidden.res,
    new URL("http://localhost/api/staff/chat/settings"),
    { service: isolated, staff },
  );
  assert.equal(forbidden.state.status, 403);
  const unsupported = response();
  await chatPreview(
    request({ method: "DELETE", staff: "owner" }),
    unsupported.res,
    new URL("http://localhost/api/staff/chat/conversations"),
    { service: isolated, staff },
  );
  assert.equal(unsupported.state.status, 405);
  assert.equal(unsupported.headers.get("allow"), "GET");
});
test("preview route saves required identity and prevents another browser from reading or replying", async () => {
  const store = new MemoryChatStore(),
    isolated = service(store),
    first = response();
  for (const invalid of [
    {},
    { name: "A", email: customer.email },
    { name: "Amy", email: "bad", phone: "07700900123" },
  ]) {
    const rejected = response();
    await chatPreview(
      request({ method: "POST", body: { requestId: "preview-invalid-contact", ...invalid } }),
      rejected.res,
      new URL("http://localhost/api/chat/conversations"),
      { service: isolated, staff, rateLimit: false },
    );
    assert.equal(rejected.state.status, 400);
    assert.equal((await store.read("local-preview")).records.length, 0);
    assert.equal(store.enquiries.size, 0);
  }
  await chatPreview(
    request({ method: "POST", body: { ...customer, requestId: "preview-isolated" } }),
    first.res,
    new URL("http://localhost/api/chat/conversations"),
    { service: isolated, staff, rateLimit: false },
  );
  assert.equal(first.state.status, 201);
  const session = JSON.parse(first.state.body);
  assert.equal(session.conversation.customerName, customer.name);
  assert.equal(session.conversation.email, customer.email);
  assert.ok(session.conversation.enquiryId);
  assert.equal(store.enquiries.size, 1);
  for (const action of ["", "/messages", "/contact", "/handover"]) {
    const result = response();
    await chatPreview(
      request({
        method: action ? "POST" : "GET",
        body: {
          body: "Hello",
          clientMessageId: "blocked-message",
          name: "Amy",
          email: "amy@example.test",
        },
      }),
      result.res,
      new URL(
        `http://localhost/api/chat/conversations/${session.conversation.id}${action}`,
      ),
      { service: isolated, staff, rateLimit: false },
    );
    assert.equal(result.state.status, 404);
  }
  const own = response();
  await chatPreview(
    request({ token: session.sessionToken }),
    own.res,
    new URL(
      `http://localhost/api/chat/conversations/${session.conversation.id}`,
    ),
    { service: isolated, staff, rateLimit: false },
  );
  assert.equal(own.state.status, 200);
  assert.ok(!own.state.body.includes("tokenHash"));
  assert.equal(own.headers.get("cache-control"), "no-store");
});
test("preview legacy sessions require contact before customer messages or handover and retain staff access", async () => {
  const store = new MemoryChatStore(),
    isolated = service(store),
    session = await isolated.start({ ...customer, requestId: "preview-legacy-fixture" }),
    state = await store.read("local-preview");
  // Simulate a session persisted by the earlier version of chat.
  Object.assign(state.records[0].conversation, {
    customerName: null,
    email: null,
    phone: null,
    enquiryId: null,
  });
  store.states.set("local-preview", state);
  store.enquiries.clear();
  const call = async (action: string, body?: unknown, member?: string) => {
    const result = response();
    await chatPreview(
      request({
        method: action ? "POST" : "GET",
        token: member ? undefined : session.sessionToken,
        staff: member,
        body,
      }),
      result.res,
      new URL(`http://localhost/api/${member ? "staff/" : ""}chat/conversations/${session.conversation.id}${action}`),
      { service: isolated, staff, rateLimit: false },
    );
    return result;
  };
  assert.equal((await call("")).state.status, 200);
  assert.equal((await call("", undefined, "owner")).state.status, 200);
  assert.equal((await call("/messages", { body: "Hello", clientMessageId: "legacy-preview-customer" })).state.status, 400);
  assert.equal((await call("/handover")).state.status, 400);
  assert.deepEqual(await store.read("local-preview"), state);
  assert.equal((await call("/messages", { body: "We can help", clientMessageId: "legacy-preview-staff" }, "owner")).state.status, 200);
  assert.equal((await call("/contact", { name: "Amy", phone: "" })).state.status, 400);
  assert.equal((await call("/contact", customer)).state.status, 200);
  assert.equal((await call("/messages", { body: "Hello", clientMessageId: "legacy-preview-customer" })).state.status, 200);
  assert.equal((await call("/handover")).state.status, 200);
  assert.equal(store.enquiries.size, 1);
});
test("preview persists hashed sessions, transcript and one contact enquiry across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "isolated-chat-"));
  const file = join(directory, "chat.json");
  const enquiries = new Map<string, ChatEnquiryInput>();
  const writer = async (input: ChatEnquiryInput) => {
    enquiries.set(input.id, input);
  };
  try {
    const store = new PreviewChatStore(file, writer),
      first = service(store);
    const session = await first.start({ ...customer, requestId: "durable-isolated" });
    const contact = await first.contact(
      session.conversation.id,
      { name: "Amy", email: "amy@example.test" },
      session.sessionToken,
    );
    const reopened = service(new PreviewChatStore(file, writer));
    assert.equal(
      (await reopened.get(session.conversation.id, session.sessionToken))
        .conversation.enquiryId,
      contact.conversation.enquiryId,
    );
    await reopened.contact(
      session.conversation.id,
      { name: "Amy", email: "amy@example.test" },
      session.sessionToken,
    );
    assert.equal(enquiries.size, 1);
    assert.ok(!(await readFile(file, "utf8")).includes(session.sessionToken));
    const histories = await readPreviewChatRecords(
      new PreviewChatStore(file, writer),
    );
    assert.equal(histories.length, 1);
    assert.ok(!JSON.stringify(histories).includes("tokenHash"));
    assert.ok(!JSON.stringify(histories).includes("requestId"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("preview durable outbox recovers an enquiry write interrupted after chat was saved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "isolated-chat-outbox-"));
  const file = join(directory, "chat.json");
  let available = false;
  const enquiries = new Map<string, ChatEnquiryInput>();
  const writer = async (input: ChatEnquiryInput) => {
    if (!available) throw new Error("isolated write interruption");
    enquiries.set(input.id, input);
  };
  try {
    const isolated = service(new PreviewChatStore(file, writer)),
      token = randomBytes(32).toString("base64url");
    await assert.rejects(
      isolated.start({ ...customer, requestId: "outbox-isolated" }, token),
      /isolated write interruption/,
    );
    const pending = JSON.parse(await readFile(file, "utf8"));
    assert.equal(pending.pending.length, 1);
    available = true;
    const reopened = service(new PreviewChatStore(file, writer));
    const own = await reopened.start({ ...customer, requestId: "outbox-isolated" }, token);
    assert.ok(own.conversation.enquiryId);
    assert.equal(own.conversation.id, pending.state.records[0].conversation.id);
    assert.equal(own.conversation.customerName, "Amy");
    assert.equal(own.messages.length, 1);
    assert.equal((await readPreviewChatRecords(new PreviewChatStore(file, writer))).length, 1);
    assert.equal(enquiries.size, 1);
    assert.equal(JSON.parse(await readFile(file, "utf8")).pending.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("preview limits chat creation and returns a retry time", async () => {
  const isolated = service();
  for (let index = 0; index < 31; index++) {
    const result = response();
    await chatPreview(
      request({
        method: "POST",
        remote: "127.0.0.1",
        body: { ...customer, requestId: `rate-limited-${index}` },
      }),
      result.res,
      new URL("http://localhost/api/chat/conversations"),
      { service: isolated, staff },
    );
    if (index < 30) assert.equal(result.state.status, 201);
    else {
      assert.equal(result.state.status, 429);
      assert.ok(Number(result.headers.get("retry-after")) > 0);
    }
  }
});
