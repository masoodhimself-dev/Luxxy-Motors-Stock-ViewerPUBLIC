import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, request } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  engine, db, dealershipsTable, dealerDomainsTable, enquiriesTable,
  enquiryEmailsTable, portalUsersTable, saleWorkspaceTable,
} from "./test/tenant-test-db";
import { resolveTenant } from "./middlewares/tenant";
import { createStaffEmailRouter } from "./routes/staff-email";
import { enquiryCaseIds } from "./lib/enquiry-case-ids";

process.env.MULTI_TENANT_ENABLED = "true";

test("customer email history follows explicit merged cases without contact-based or cross-dealer leakage", async (t) => {
  for (const name of (await readdir("../../lib/db/drizzle"))
    .filter((name) => /^\d.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile("../../lib/db/drizzle/" + name, "utf8"));
  }
  for (const dealer of ["scope-a", "scope-b"]) {
    await db.insert(dealershipsTable).values({
      id: dealer, name: dealer, status: "active",
      canonicalOrigin: `https://${dealer}.example.test`, stockPlatform: "autotrader",
      retailerId: dealer, sourceUrl: "https://www.autotrader.co.uk/example",
    });
    await db.insert(dealerDomainsTable).values({
      hostname: `${dealer}.example.test`, dealerId: dealer,
      verified: true, verificationToken: "fictional",
    });
    await db.insert(portalUsersTable).values({
      dealerId: dealer, authUserId: `user_${dealer}`, role: "owner",
    });
  }
  const ids = Object.fromEntries([
    "root", "child", "grandchild", "sibling", "unrelated", "foreign", "crossChild",
    "cycleOne", "cycleTwo", "cycleChild",
  ].map((name) => [name, randomUUID()]));
  for (const [name, id] of Object.entries(ids)) {
    await db.insert(enquiriesTable).values({
      id, dealerId: name === "foreign" ? "scope-b" : "scope-a", type: "general",
      customerName: "Same fictional customer", email: "same@example.test", phone: "07000000000",
      reference: name, message: "Fictional enquiry",
      ...(name === "child" ? { customerNotificationAttemptedAt: new Date("2026-10-16T09:00:00Z"), customerNotificationStatus: "sent" } : {}),
      ...(name === "grandchild" ? { reminderAttemptedAt: new Date("2026-10-16T09:01:00Z"), reminderStatus: "sent" } : {}),
    });
  }
  for (const [child, parent] of [
    ["child", "root"], ["grandchild", "child"], ["sibling", "root"],
    ["crossChild", "foreign"], ["cycleOne", "cycleTwo"],
    ["cycleTwo", "cycleOne"], ["cycleChild", "cycleTwo"],
  ]) {
    await db.execute(sql`UPDATE enquiries SET merged_into_id=${ids[parent]}::uuid WHERE id=${ids[child]}::uuid`);
  }
  for (const [name, id] of Object.entries(ids)) {
    await db.insert(enquiryEmailsTable).values({
      id: randomUUID(), dealerId: name === "foreign" ? "scope-b" : "scope-a",
      enquiryId: id, requestId: randomUUID(), requestHash: "fictional", status: "sent",
      recipient: "same@example.test", subject: `${name} reply`, message: "Saved message",
      ...(name === "root" ? { renderedText: "The exact rendered reply saved for the customer." } : {}),
      createdBy: "fictional", createdAt: new Date("2026-10-16T10:00:00Z"),
    });
  }
  const saleIds: Record<string, string> = {};
  for (const source of ["child", "unrelated", "none"]) {
    saleIds[source] = randomUUID();
    await db.insert(saleWorkspaceTable).values({
      id: saleIds[source], dealerId: "scope-a", reference: `SALE-${source}`, revision: 0,
      state: {
        draft: {
          customer: "Same fictional customer",
          ...(source !== "none" ? { sourceEnquiryId: ids[source] } : {}),
        },
        documents: [{ id: "invoice-1", title: "Full invoice", number: `INV-${source}` }],
        emailDeliveries: [{
          id: "delivery-1", documentId: "invoice-1", to: "same@example.test", status: "sent",
          attemptedAt: "2026-10-16T11:00:00Z",
        }],
      },
    });
  }
  let providerCalls = 0;
  const app = express();
  app.use(resolveTenant);
  app.use("/api", createStaffEmailRouter(async () => {
    providerCalls++;
    throw new Error("Read-only email listing must not contact the provider");
  }, async () => ({ enabled: true, apiKey: "re_fictional", from: "sales@example.test", replyTo: "reply@example.test" })));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const call = (query = "", host = "scope-a", user = `user_${host}`) => new Promise<{ status: number; data: any }>((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1", port, path: `/api/staff/email${query}`, method: "GET",
      headers: { host: `${host}.example.test`, ...(user ? { "x-test-user": user } : {}) },
    }, (res) => {
      let body = "";
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode!, data: JSON.parse(body) }));
    });
    req.on("error", reject);
    req.end();
  });
  const group = [ids.root, ids.child, ids.grandchild, ids.sibling].sort();
  try {
    await t.test("finds ancestors, descendants and siblings from any member", async () => {
      for (const member of group) {
        assert.deepEqual(await enquiryCaseIds("scope-a", member), group);
      }
      assert.deepEqual(await enquiryCaseIds("scope-a", ids.unrelated), [ids.unrelated]);
    });
    await t.test("terminates cycles and never traverses a foreign dealer", async () => {
      assert.deepEqual(await enquiryCaseIds("scope-a", ids.cycleOne), [ids.cycleOne, ids.cycleTwo, ids.cycleChild].sort());
      assert.deepEqual(await enquiryCaseIds("scope-a", ids.crossChild), [ids.crossChild]);
      assert.deepEqual(await enquiryCaseIds("scope-a", ids.foreign), []);
      assert.deepEqual(await enquiryCaseIds("scope-a", randomUUID()), []);
      assert.deepEqual(await enquiryCaseIds("scope-a", "invalid"), []);
    });
    await t.test("includes manual, confirmation, reminder and sales emails only for the explicit case", async () => {
      for (const enquiryId of [ids.root, ids.grandchild]) {
        const result = await call(`?enquiryId=${enquiryId}`);
        assert.equal(result.status, 200);
        assert.equal(result.data.replyTo, "reply@example.test");
        assert.equal(result.data.hasMore, false);
        assert.equal(result.data.messages.length, 7);
        assert.ok(result.data.messages.every((message: any) => group.includes(message.enquiry_id)));
        assert.deepEqual([...new Set(result.data.messages.map((message: any) => message.kind))].sort(), ["enquiry", "notification", "reminder", "sale"]);
      }
    });
    await t.test("unknown and foreign IDs produce no emails; invalid IDs are rejected", async () => {
      for (const enquiryId of [randomUUID(), ids.foreign]) {
        const result = await call(`?enquiryId=${enquiryId}`);
        assert.equal(result.status, 200);
        assert.deepEqual(result.data.messages, []);
        assert.equal(result.data.hasMore, false);
      }
      assert.equal((await call("?enquiryId=invalid")).status, 400);
      assert.equal((await call(`?enquiryId=${ids.root}&enquiryId=${ids.child}`)).status, 400);
      assert.equal((await call("", "scope-a", "")).status, 401);
    });
    await t.test("keeps existing global search and offset semantics", async () => {
      const global = await call();
      assert.equal(global.status, 200);
      assert.equal(global.data.messages.length, 14);
      assert.ok(global.data.messages.some((message: any) => message.enquiry_id === ids.unrelated));
      assert.ok(global.data.messages.some((message: any) => message.enquiry_id === null));
      assert.ok(global.data.messages.every((message: any) => message.enquiry_id !== ids.foreign));
      const searched = await call(`?enquiryId=${ids.root}&q=grandchild%20reply`);
      assert.equal(searched.data.messages.length, 1);
      assert.equal(searched.data.messages[0].enquiry_id, ids.grandchild);
      const offset = await call(`?enquiryId=${ids.root}&offset=2`);
      const full = await call(`?enquiryId=${ids.root}`);
      assert.deepEqual(offset.data.messages, full.data.messages.slice(2));
      assert.equal((await call("?offset=-1")).status, 400);
    });
    await t.test("loads saved bodies only inside an authorised case or sale conversation", async () => {
      assert.equal((await call("?includeBody=true")).status, 400);
      assert.equal((await call("?includeBody=yes")).status, 400);
      assert.equal((await call(`?enquiryId=${ids.root}&saleId=${saleIds.child}&includeBody=true`)).status, 400);
      const summaries = await call(`?enquiryId=${ids.root}`);
      assert.ok(summaries.data.messages.every((row: any) => !("message" in row)));
      const conversation = await call(`?enquiryId=${ids.root}&includeBody=true`);
      assert.equal(conversation.status, 200);
      assert.equal(conversation.data.messages.length, 7);
      assert.equal(conversation.data.messages.find((row: any) => row.subject === "root reply").message, "The exact rendered reply saved for the customer.");
      assert.equal(conversation.data.messages.find((row: any) => row.subject === "child reply").message, "Saved message");
      assert.ok(conversation.data.messages.filter((row: any) => row.kind !== "enquiry").every((row: any) => typeof row.message === "string"));
      assert.deepEqual((await call(`?enquiryId=${ids.foreign}&includeBody=true`)).data.messages, []);
      const sale = await call(`?saleId=${saleIds.none}&includeBody=true`);
      assert.equal(sale.status, 200);
      assert.equal(sale.data.messages.length, 1);
      assert.equal(sale.data.messages[0].sale_id, saleIds.none);
      assert.equal(sale.data.messages[0].message, "The original saved document was attached to this email.");
      assert.deepEqual((await call(`?saleId=${saleIds.none}&includeBody=true`, "scope-b")).data.messages, []);
      assert.equal((await call("?saleId=invalid&includeBody=true")).status, 400);
      assert.equal(providerCalls, 0);
    });
    await t.test("applies the case filter before pagination and never calls a sender", async () => {
      const before = (await db.execute(sql`SELECT count(*)::int AS count FROM enquiry_emails`)).rows[0].count;
      for (let index = 0; index < 53; index++) {
        await db.insert(enquiryEmailsTable).values({
          id: randomUUID(), dealerId: "scope-a", enquiryId: ids.root, requestId: randomUUID(),
          requestHash: "fictional", status: "sent", recipient: "same@example.test",
          subject: `Older scope message ${index}`, message: "Saved", createdBy: "fictional",
          createdAt: new Date("2026-10-15T10:00:00Z"),
        });
      }
      const first = await call(`?enquiryId=${ids.root}&includeBody=true`);
      const second = await call(`?enquiryId=${ids.root}&includeBody=true&offset=50`);
      assert.equal(first.data.messages.length, 50);
      assert.equal(first.data.hasMore, true);
      assert.equal(second.data.messages.length, 10);
      assert.equal(second.data.hasMore, false);
      assert.equal(new Set([...first.data.messages, ...second.data.messages].map((message: any) => message.key)).size, 60);
      assert.ok([...first.data.messages, ...second.data.messages].every((message: any) => typeof message.message === "string"));
      assert.equal(providerCalls, 0);
      const after = (await db.execute(sql`SELECT count(*)::int AS count FROM enquiry_emails`)).rows[0].count;
      assert.equal(Number(after) - Number(before), 53, "GETs did not create delivery records");
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
  }
});
