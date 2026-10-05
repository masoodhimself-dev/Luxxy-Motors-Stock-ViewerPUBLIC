import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes } from "node:crypto";
import express from "express";
import type { ChatSession } from "@workspace/vehicle-meta";
import {
  DealerChatService,
  MemoryChatStore,
  ChatError,
  chatAnswer,
  chatAvailability,
  chatTokenHash,
  emptyChatState,
  type ChatTransaction,
  type ChatDealer,
  type ChatStock,
} from "./lib/dealer-chat";
import {
  PostgresChatStore,
  readDealerChatRecords,
} from "./lib/dealer-chat-store";
const at = "2026-10-05T10:00:00Z";
const customer = { name: "Amy", email: "amy@example.test" };
const dealer: ChatDealer = {
  identity: { name: "Test Showroom" },
  hours: [
    { days: "Monday - Friday", times: "9:00am - 6:00pm" },
    { days: "Saturday", times: "09:00 - 17:00" },
    { days: "Sunday", times: "By appointment" },
  ],
  warranty: {
    enabled: true,
    description: "Warranty options on eligible cars.",
  },
  delivery: { enabled: true, description: "Delivery can be arranged." },
  onlineReservation: { enabled: true, terms: 'Reservation terms for this synthetic dealer.', depositPence: 10000 },
};
const car: ChatStock = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Ford Fiesta",
  price: 5900,
  inventoryStatus: "available",
  mileage: 50000,
  transmission: "Manual",
  fuel: "Petrol",
  registration: "AB12 CDE",
};
test('direct questions about the assistant receive an honest identity answer', () => {
  for (const question of ['Are you a real person?', 'Is this a bot?', 'Am I talking to a human?', 'Who are you?']) {
    const answer = chatAnswer(question, car, dealer);
    assert.match(answer.body, /automated assistant/);
    assert.doesNotMatch(answer.body, /I am a person|I’m a person|real person/);
  }
});
test('advertised prices remain available without reservations and reservation actions require valid terms and amounts', () => {
  for (const onlineReservation of [undefined, { enabled: false }, { enabled: true, terms: '' }]) {
    const config = { ...dealer, onlineReservation };
    assert.match(chatAnswer('What is the price?', car, config).body, /£5,900/);
    assert.equal(chatAnswer('Can I reserve it?', car, config).actions.length, 0);
  }
  assert.equal(chatAnswer('Can I reserve it?', car, { ...dealer, onlineReservation: { enabled: true, terms: 'Terms', depositPence: 900000 } }).actions.length, 0);
  assert.equal(chatAnswer('Can I reserve it?', car, dealer).actions[0]?.href, `/vehicle/${car.id}#reserve-car-online`);
});
function setup(store = new MemoryChatStore()) {
  let now = new Date(at),
    liveCar: ChatStock | null = car;
  const service = new DealerChatService(store, {
    dealerId: () => "dealer-a",
    dealer: async () => dealer,
    vehicle: async (id) => (id === car.id ? liveCar : null),
    staff: async () => [{ id: "alex", name: "Alex" }],
    now: () => now,
  });
  return {
    store,
    service,
    clock: (value: string) => {
      now = new Date(value);
    },
    stock: (value: ChatStock | null) => {
      liveCar = value;
    },
  };
}
function legacySession(store: MemoryChatStore) {
  const token = randomBytes(32).toString("base64url"),
    id = "00000000-0000-4000-8000-000000000099",
    state = emptyChatState();
  state.records.push({
    tokenHash: chatTokenHash(token),
    tokenExpiresAt: "2026-11-04T10:00:00Z",
    requestId: "legacy-anonymous",
    conversation: {
      id,
      reference: "LEGACY",
      vehicle: null,
      enquiryId: null,
      customerName: null,
      email: null,
      phone: null,
      status: "assistant",
      assignedToId: null,
      assignedToName: null,
      callbackRequested: false,
      unreadCount: 0,
      lastMessage: "Hello",
      createdAt: at,
      updatedAt: at,
      revision: 1,
    },
    messages: [{
      id: "legacy-greeting",
      conversationId: id,
      authorRole: "assistant",
      authorName: "Showroom assistant",
      body: "Hello",
      createdAt: at,
      actions: [],
      clientMessageId: null,
    }],
  });
  store.states.set("dealer-a", state);
  return { id, token };
}
test("new chats require a bounded name and valid contact, rejecting invalid provided extras without writes", async () => {
  const { service, store } = setup();
  for (const invalid of [
    {},
    { name: "Amy" },
    { name: " ", email: customer.email },
    { name: "A", email: customer.email },
    { name: "x".repeat(121), email: customer.email },
    { name: 123, email: customer.email },
    { name: "Amy", email: "bad" },
    { name: "Amy", email: " ", phone: "07700900123" },
    { name: "Amy", email: "x".repeat(245) + "@example.test" },
    { name: "Amy", email: customer.email, phone: "bad" },
    { name: "Amy", email: "bad", phone: "07700900123" },
    { name: "Amy", phone: "123456" },
    { name: "Amy", phone: "1234567890123456" },
    { name: "Amy", phone: "(".repeat(31) },
    { name: "Amy", email: null, phone: null },
  ]) {
    await assert.rejects(
      service.start({ requestId: "invalid-start-contact", ...invalid }),
      (error: ChatError) => error instanceof ChatError && error.status === 400,
    );
    assert.equal((await store.read("dealer-a")).records.length, 0);
    assert.equal(store.enquiries.size, 0);
  }
});
test("phone-only chats save normalized contact and an enquiry before any question", async () => {
  const { service, store } = setup();
  const session = await service.start({
    requestId: "start-phone-only",
    name: " Amy ",
    phone: " +44 (7700) 900-123 ",
  });
  assert.equal(session.conversation.customerName, "Amy");
  assert.equal(session.conversation.phone, "+447700900123");
  assert.equal(session.conversation.email, null);
  assert.equal(session.conversation.status, "assistant");
  assert.equal(session.messages.length, 1);
  assert.equal(store.enquiries.size, 1);
  assert.equal([...store.enquiries.values()][0].id, session.conversation.enquiryId);
  assert.equal([...store.enquiries.values()][0].phone, "+447700900123");
  assert.equal((await service.inbox()).totalUnread, 1);
  const resumed = await service.get(session.conversation.id, session.sessionToken);
  assert.equal(resumed.conversation.customerName, "Amy");
  const answered = await service.message(
    session.conversation.id,
    { body: "What are the opening hours?", clientMessageId: "identified-resume-message" },
    session.sessionToken,
  );
  assert.match(answered.messages.at(-1)!.body, /published hours/);
});
test("automatic answers disabled keeps identified starts waiting for staff", async () => {
  const { service, store } = setup();
  await service.settings({ automaticAnswers: false });
  const session = await service.start({
    ...customer,
    requestId: "start-without-automation",
    message: "What is the price?",
    vehicleId: car.id,
  });
  assert.equal(session.conversation.status, "waiting_staff");
  assert.equal(session.messages.at(-1)!.authorRole, "customer");
  assert.equal(store.enquiries.size, 1);
  assert.equal([...store.enquiries.values()][0].vehicle?.id, car.id);
});
test("an enquiry failure rolls back the new identity, messages and session together", async () => {
  class FailingEnquiryStore extends MemoryChatStore {
    override transaction<T>(id: string, work: (tx: ChatTransaction) => Promise<T>) {
      return super.transaction(id, (tx) => work({
        ...tx,
        saveEnquiry: async () => { throw new Error("isolated enquiry failure"); },
      }));
    }
  }
  const { service, store } = setup(new FailingEnquiryStore());
  await assert.rejects(
    service.start({ ...customer, requestId: "start-atomic-failure", message: "Hello" }),
    /isolated enquiry failure/,
  );
  assert.equal((await store.read("dealer-a")).records.length, 0);
  assert.equal(store.enquiries.size, 0);
});
test("legacy anonymous chats can resume and receive staff replies but need contact before customer writes", async () => {
  const { service, store } = setup(),
    legacy = legacySession(store);
  const original = await store.read("dealer-a");
  assert.equal((await service.get(legacy.id, legacy.token)).conversation.customerName, null);
  assert.equal((await service.inbox()).conversations.length, 1);
  assert.equal((await service.get(legacy.id, undefined, true)).messages.length, 1);
  for (const action of [
    () => service.message(legacy.id, { body: "Hello", clientMessageId: "legacy-customer-message" }, legacy.token),
    () => service.handover(legacy.id, legacy.token),
  ])
    await assert.rejects(action(), (error: ChatError) => error.status === 400 && /name.*email.*phone/.test(error.message));
  assert.deepEqual(await store.read("dealer-a"), original);
  assert.equal(store.enquiries.size, 0);
  const reply = await service.message(
    legacy.id,
    { body: "Please leave a way for us to reach you", clientMessageId: "legacy-staff-reply" },
    undefined,
    { id: "alex", name: "Alex" },
  );
  assert.equal(reply.conversation.status, "with_staff");
  const identified = await service.contact(legacy.id, customer, legacy.token);
  assert.ok(identified.conversation.enquiryId);
  assert.equal(identified.conversation.status, "with_staff");
  const sent = await service.message(
    legacy.id,
    { body: "Hello", clientMessageId: "legacy-customer-message" },
    legacy.token,
  );
  assert.equal(sent.messages.at(-1)!.authorRole, "customer");
  await service.handover(legacy.id, legacy.token);
  assert.equal(store.enquiries.size, 1);
});
test("identified chat starts with a linked enquiry, automatic answer and hashed random token", async () => {
  const { service, store } = setup();
  const session = await service.start({
    ...customer,
    requestId: "start-identified",
    name: " Amy ",
    email: " AMY@EXAMPLE.TEST ",
    vehicleId: car.id,
    message: "What is the price?",
  });
  assert.equal(session.conversation.customerName, "Amy");
  assert.equal(session.conversation.email, "amy@example.test");
  assert.equal(session.conversation.status, "assistant");
  assert.ok(session.conversation.enquiryId);
  assert.equal(session.messages[1].authorName, "Amy");
  assert.match(session.messages.at(-1)!.body, /£5,900/);
  assert.equal(store.enquiries.size, 1);
  assert.equal(
    store.states.get("dealer-a")!.records[0].tokenHash,
    chatTokenHash(session.sessionToken),
  );
  assert.ok(!JSON.stringify([...store.states.values()]).includes(session.sessionToken));
  assert.equal(session.conversation.vehicle?.registration, "AB12 CDE");
  assert.ok(!("tokenHash" in session));
});
test("a pre-generated bearer token recovers a lost start response without exposing sessions by request id", async () => {
  const { service, store, stock } = setup();
  const token = randomBytes(32).toString("base64url");
  const first = await service.start({ ...customer, requestId: "start-recover" }, token);
  stock(null);
  const retry = await service.start({
    requestId: "start-recover",
    name: "Different person",
    phone: "invalid",
    vehicleId: car.id,
  }, token);
  assert.equal(first.conversation.id, retry.conversation.id);
  assert.equal(first.sessionToken, token);
  assert.equal(retry.conversation.customerName, "Amy");
  assert.equal(retry.conversation.email, customer.email);
  assert.equal(retry.conversation.enquiryId, first.conversation.enquiryId);
  assert.equal(store.enquiries.size, 1);
  assert.equal(store.states.get("dealer-a")!.records.length, 1);
  await assert.rejects(
    service.start({ ...customer, requestId: "start-recover" }),
    (e: ChatError) => e.status === 409,
  );
});
test("wrong tokens, cross-dealer ids and expired tokens cannot read or write chats", async () => {
  const { service, store, clock } = setup();
  const session = await service.start({ ...customer, requestId: "start-private" });
  const id = session.conversation.id;
  await assert.rejects(
    service.get(id, "invalid"),
    (e: ChatError) => e.status === 404,
  );
  await assert.rejects(
    service.contact(
      id,
      { name: "Amy", email: "amy@example.test" },
      randomBytes(32).toString("base64url"),
    ),
    (e: ChatError) => e.status === 404,
  );
  const other = new DealerChatService(store, {
    dealerId: () => "dealer-b",
    dealer: async () => dealer,
    vehicle: async () => car,
    staff: async () => [],
  });
  await assert.rejects(other.get(id, session.sessionToken));
  clock("2026-12-01T10:00:00Z");
  await assert.rejects(service.get(id, session.sessionToken));
  assert.equal(store.enquiries.size, 1);
});
test("contact and message retries keep one enquiry and one transcript", async () => {
  const { service, store } = setup();
  const session = await service.start({
    ...customer,
    requestId: "start-contact",
    vehicleId: car.id,
  });
  const id = session.conversation.id;
  await service.message(
    id,
    { body: "Please call me", clientMessageId: "message-contact" },
    session.sessionToken,
  );
  const first = await service.contact(
    id,
    { name: "Amy", phone: "07700 900123", callbackRequested: true },
    session.sessionToken,
  );
  const second = await service.contact(
    id,
    { name: "Amy", phone: "07700 900123", callbackRequested: true },
    session.sessionToken,
  );
  assert.equal(first.conversation.enquiryId, second.conversation.enquiryId);
  assert.equal(first.messages.length, second.messages.length);
  await service.message(
    id,
    { body: "Please call me", clientMessageId: "message-contact" },
    session.sessionToken,
  );
  assert.equal(store.enquiries.size, 1);
  const enquiry = [...store.enquiries.values()][0];
  assert.equal(enquiry.vehicle?.id, car.id);
  assert.equal(enquiry.phone, "07700900123");
  assert.equal(enquiry.callbackRequested, true);
  assert.equal(enquiry.message.split("Please call me").length - 1, 1);
  await assert.rejects(
    service.message(
      id,
      { body: "Changed body", clientMessageId: "message-contact" },
      session.sessionToken,
    ),
    (e: ChatError) => e.status === 409,
  );
});
test("staff replies take over; resolved chats reopen to staff without automated answers", async () => {
  const { service } = setup();
  const s = await service.start({
    ...customer,
    requestId: "start-takeover",
    vehicleId: car.id,
  });
  let view = await service.message(
    s.conversation.id,
    { body: "I can help", clientMessageId: "reply-staff" },
    undefined,
    { id: "alex", name: "Alex" },
  );
  assert.equal(view.conversation.status, "with_staff");
  view = await service.message(
    s.conversation.id,
    { body: "Price please", clientMessageId: "message-after" },
    s.sessionToken,
  );
  assert.equal(view.messages.at(-1)!.authorRole, "customer");
  assert.equal(
    view.conversation.assignedToId,
    null,
    "public view hides assignment identity",
  );
  const staff = await service.get(s.conversation.id, undefined, true);
  await service.update(s.conversation.id, {
    status: "resolved",
    expectedRevision: staff.conversation.revision,
  });
  view = await service.message(
    s.conversation.id,
    { body: "One more question", clientMessageId: "message-reopen" },
    s.sessionToken,
  );
  assert.equal(view.conversation.status, "waiting_staff");
  assert.equal(view.messages.at(-1)!.authorRole, "customer");
  await assert.rejects(
    service.update(s.conversation.id, {
      status: "resolved",
      expectedRevision: 0,
    }),
    (e: ChatError) => e.status === 409,
  );
});
test("unknowns and private facts hand over; subsequent customer messages do not keep answering", async () => {
  const { service, stock } = setup();
  const s = await service.start({
    ...customer,
    requestId: "start-unknown",
    vehicleId: car.id,
    message: "Has it had an accident?",
  });
  assert.equal(s.conversation.status, "waiting_staff");
  let view = await service.message(
    s.conversation.id,
    { body: "What is the price?", clientMessageId: "message-unknown" },
    s.sessionToken,
  );
  assert.equal(view.messages.at(-1)!.authorRole, "customer");
  const other = await service.start({
    ...customer,
    requestId: "start-current",
    vehicleId: car.id,
  });
  stock({ ...car, inventoryStatus: "reserved" });
  view = await service.message(
    other.conversation.id,
    { body: "Is it available?", clientMessageId: "message-stock" },
    other.sessionToken,
  );
  assert.match(view.messages.at(-1)!.body, /reserved/);
  assert.equal(view.conversation.status, "waiting_staff");
});
test("factual answers use published data and eligible action links only", () => {
  assert.match(chatAnswer("What is the mileage?", car, dealer).body, /50,000/);
  assert.equal(
    chatAnswer("What is the service history?", car, dealer).handover,
    true,
  );
  assert.equal(
    chatAnswer("What is my payment status?", car, dealer).handover,
    true,
  );
  assert.equal(
    chatAnswer(
      "Please reserve it",
      { ...car, inventoryStatus: "reserved" },
      dealer,
    ).actions.length,
    0,
  );
  assert.equal(
    chatAnswer("Book a test drive", car, dealer).actions[0].kind,
    "book_test_drive",
  );
  assert.equal(
    chatAnswer("Please reserve it", car, {
      ...dealer,
      onlineReservation: { enabled: false },
    }).actions.length,
    0,
  );
  assert.equal(chatAnswer("How many seats?", car, dealer).handover, true);
});
test("London opening hours and a 90 second staff heartbeat determine online presence", async () => {
  const { service, clock } = setup();
  assert.equal((await service.config()).availability.showroomState, "open");
  assert.equal((await service.config()).availability.staffOnline, false);
  await service.presence("alex", true);
  assert.equal((await service.config()).availability.staffOnline, true);
  clock("2026-10-05T10:01:31Z");
  assert.equal((await service.config()).availability.staffOnline, false);
  assert.equal(
    chatAvailability(
      dealer.hours,
      { alex: { available: true, expiresAt: "2026-10-05T19:01:00Z" } },
      new Date("2026-10-05T19:00:00Z"),
    ).staffOnline,
    false,
  );
  assert.equal(
    chatAvailability(dealer.hours, {}, new Date("2026-10-04T10:00:00Z"))
      .showroomState,
    "unknown",
  );
  assert.match(
    chatAvailability(dealer.hours, {}, new Date("2026-10-04T10:00:00Z"))
      .nextOpening!,
    /tomorrow at 09:00/,
  );
  assert.equal(
    chatAvailability(dealer.hours, {}, new Date("2026-10-26T09:00:00Z"))
      .showroomState,
    "open",
  );
});
test("invalid contact updates preserve identity and disabled settings block new sessions", async () => {
  const { service, store } = setup();
  const s = await service.start({ ...customer, requestId: "start-disabled" });
  await assert.rejects(
    service.contact(
      s.conversation.id,
      { name: "Amy", email: "bad", callbackRequested: true },
      s.sessionToken,
    ),
  );
  assert.equal(store.enquiries.size, 1);
  for (const invalid of [
    { name: "Amy", email: "", phone: "" },
    { name: "", email: customer.email },
    { name: "Amy", email: customer.email, phone: "bad" },
    { name: "Amy", email: customer.email, callbackRequested: true },
  ]) {
    const before = await store.read("dealer-a");
    await assert.rejects(service.contact(s.conversation.id, invalid, s.sessionToken), ChatError);
    assert.deepEqual(await store.read("dealer-a"), before);
  }
  assert.equal([...store.enquiries.values()][0].name, "Amy");
  assert.equal([...store.enquiries.values()][0].email, customer.email);
  await service.settings({ enabled: false, automaticAnswers: false });
  await assert.rejects(
    service.start({ ...customer, requestId: "start-disabled-2" }),
    (e: ChatError) => e.status === 503,
  );
  await assert.rejects(service.settings({ greeting: "" }));
  await assert.rejects(service.settings({ secret: "arbitrary" }));
  assert.equal((await service.config()).settings.enabled, false);
});
test("Postgres chat write rolls back atomically and releases the connection", async () => {
  const queries: string[] = [];
  let released = false;
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      return {
        rows: sql.startsWith("SELECT state")
          ? [
              {
                state: {
                  schemaVersion: 1,
                  settings: {},
                  records: [],
                  presence: {},
                },
              },
            ]
          : [],
      };
    },
    release: () => {
      released = true;
    },
  };
  const store = new PostgresChatStore({
    ...client,
    connect: async () => client,
  });
  await assert.rejects(
    store.transaction("dealer-a", async () => {
      throw new Error("write failed");
    }),
  );
  assert.ok(queries.includes("ROLLBACK"));
  assert.ok(!queries.includes("COMMIT"));
  assert.equal(released, true);
});
test("history tolerates only the prepared chat table missing before migration", async () => {
  assert.deepEqual(
    await readDealerChatRecords("dealer-a", {
      query: async () => {
        throw Object.assign(new Error(), { code: "42P01" });
      },
    }),
    [],
  );
  await assert.rejects(
    readDealerChatRecords("dealer-a", {
      query: async () => {
        throw Object.assign(new Error(), { code: "42501" });
      },
    }),
  );
});
test("marking read returns the updated revision without changing the last activity time", async () => {
  const { service } = setup();
  const session = await service.start({
    ...customer,
    requestId: "start-read-revision",
    message: "Hello",
  });
  const read = await service.read(session.conversation.id);
  assert.equal(read.conversation.unreadCount, 0);
  assert.equal(read.conversation.revision, session.conversation.revision + 1);
  assert.equal(read.conversation.updatedAt, session.conversation.updatedAt);
  assert.equal(
    (await service.read(session.conversation.id)).conversation.revision,
    read.conversation.revision,
  );
  assert.equal((await service.presence("alex", true)).staffOnline, true);
});
test("disabling chat blocks writes from an existing customer token but lets staff finish the conversation", async () => {
  const { service } = setup();
  const session = await service.start({ ...customer, requestId: "start-existing-disabled" });
  await service.settings({ enabled: false });
  await assert.rejects(
    service.message(
      session.conversation.id,
      { body: "Hello", clientMessageId: "disabled-message" },
      session.sessionToken,
    ),
    (e: ChatError) => e.status === 503,
  );
  await assert.rejects(
    service.contact(
      session.conversation.id,
      { name: "Amy", email: "amy@example.test" },
      session.sessionToken,
    ),
    (e: ChatError) => e.status === 503,
  );
  await assert.rejects(
    service.handover(session.conversation.id, session.sessionToken),
    (e: ChatError) => e.status === 503,
  );
  assert.equal(
    (
      await service.message(
        session.conversation.id,
        {
          body: "We can help by phone",
          clientMessageId: "disabled-staff-reply",
        },
        undefined,
        { id: "alex", name: "Alex" },
      )
    ).conversation.status,
    "with_staff",
  );
});
test("published equipment is quoted accurately and absent features do not become claims", () => {
  const equipped = {
    ...car,
    sourceExtras: {
      features: ["Interior", "Bluetooth", "Rear parking sensors", "Bluetooth"],
    },
  };
  assert.match(
    chatAnswer("Does it have Bluetooth?", equipped, dealer).body,
    /Bluetooth/,
  );
  assert.equal(
    chatAnswer("Does it have Apple CarPlay?", equipped, dealer).handover,
    true,
  );
  assert.match(
    chatAnswer("What features are listed?", equipped, dealer).body,
    /Rear parking sensors/,
  );
});
test("empty and oversized customer messages fail without changing chat state", async () => {
  const { service } = setup();
  const session = await service.start({ ...customer, requestId: "start-size-validation" });
  for (const body of ["", " ".repeat(3), "x".repeat(2001)])
    await assert.rejects(
      service.message(
        session.conversation.id,
        { body, clientMessageId: "invalid-message" },
        session.sessionToken,
      ),
      ChatError,
    );
  assert.equal(
    (await service.get(session.conversation.id, session.sessionToken)).messages
      .length,
    1,
  );
});
test("HTTP routes protect public sessions, staff writes, settings permissions and unsupported methods", async () => {
  process.env.DATABASE_URL =
    "postgresql://unused:unused@127.0.0.1:1/unused_chat_test";
  const { createDealerChatRouter } = await import("./routes/dealer-chat");
  const { service, store } = setup();
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createDealerChatRouter({
      service,
      rateLimit: false,
      staffAuth: (req, res, next) => {
        if (!req.get("X-Test-Staff")) {
          res.status(401).json({ error: "sign in" });
          return;
        }
        req.staff = {
          authUserId: "alex",
          email: "alex@example.test",
          name: "Alex",
          role: "salesperson",
          permissions: [],
        };
        next();
      },
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const request = (
    path: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(url + path, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const config = await request("/chat/config");
    assert.equal(config.headers.get("cache-control"), "no-store");
    for (const invalid of [
      { requestId: "http-missing-contact" },
      { requestId: "http-invalid-contact", name: "Amy", email: "bad", phone: "07700900123" },
    ])
      assert.equal((await request("/chat/conversations", "POST", invalid)).status, 400);
    assert.equal(store.enquiries.size, 0);
    const start = await request("/chat/conversations", "POST", {
      ...customer,
      requestId: "http-start",
    });
    const session = (await start.json()) as ChatSession;
    assert.equal(start.status, 201);
    assert.equal(session.conversation.customerName, customer.name);
    assert.ok(session.conversation.enquiryId);
    assert.equal(store.enquiries.size, 1);
    const retry = await request("/chat/conversations", "POST", {
      requestId: "http-start",
      name: "Other person",
      phone: "invalid",
    }, { "X-Chat-Token": session.sessionToken });
    assert.equal(retry.status, 201);
    assert.deepEqual(await retry.json(), session);
    assert.equal(store.enquiries.size, 1);
    assert.equal(
      (await request(`/chat/conversations/${session.conversation.id}`)).status,
      404,
    );
    assert.equal(
      (
        await request(
          `/chat/conversations/${session.conversation.id}`,
          "GET",
          undefined,
          { "X-Chat-Token": session.sessionToken },
        )
      ).status,
      200,
    );
    assert.equal((await request("/staff/chat/conversations")).status, 401);
    assert.equal(
      (
        await request("/staff/chat/settings", "GET", undefined, {
          "X-Test-Staff": "yes",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/staff/chat/settings",
          "PATCH",
          { enabled: false },
          { "X-Test-Staff": "yes" },
        )
      ).status,
      403,
    );
    const forbidden = await request("/staff/chat/conversations", "DELETE");
    assert.equal(forbidden.status, 401);
    assert.equal((await request("/chat/config", "PUT")).status, 405);
    const own = await request("/staff/chat/conversations", "GET", undefined, {
      "X-Test-Staff": "yes",
    });
    assert.equal(own.status, 200);
    assert.ok(!JSON.stringify(await own.json()).includes(session.sessionToken));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
