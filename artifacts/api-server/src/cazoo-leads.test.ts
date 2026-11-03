import { createCustomerEmailWebhook } from "./routes/customer-email-webhook";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import express from "express";
import { Webhook } from "svix";
import { engine } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import { cazooTestSender, parseCazooDelivery } from "./lib/cazoo-owner-test";
import { parseCazooLead } from "./lib/cazoo-lead-parser";
import {
  acceptCazooLeadEvent,
  cazooLeadMailboxes,
  processCazooLeads,
  draftCazooReply,
} from "./lib/cazoo-leads";
import { createCazooLeadWebhook } from "./routes/cazoo-lead-webhook";
import { createCazooLeadRouter } from "./routes/cazoo-leads";
const address = "cazoo@leads.a.example.test",
  second = "cazoo@leads.b.example.test";
const carId = randomUUID(),
  otherCarId = randomUUID();
const tenant = (dealerId = "cazoo-a") => ({
  dealerId,
  canonicalOrigin: "https://a.example.test",
  platform: "cazoo" as const,
  retailerId: "fake",
  sourceUrl: "https://www.cazoo.co.uk/fake",
});
const text = (correlation = "a".repeat(32)) =>
  `New sales lead\nLexus RX\nAB15CDE Listed at £9,500\nQuestion\nCall Sam\nEmail Sam\nCustomer message\nDo you accept px for a Lexus GS450h 2008?\nEnquiry type\nQuestion\nCustomer details\nSam Example\n07400000000\nsam@example.test\nCall Sam\nEmail Sam\ncazoo logo\nThis email was sent by Motors.co.uk Limited\nOriginal Recipients: ${address}\nCorrelationID: ${correlation}`;
const email = (id = randomUUID(), extra: Record<string, any> = {}) => ({
  id,
  to: [address],
  from: "Cazoo <dealerleads@info.cazoo.co.uk>",
  subject: "Enquiry - Lexus RX AB15CDE - sam",
  text: text(),
  authentication: { dmarc: "pass", dkim: "pass" },
  ...extra,
});
async function receipt(id: string) {
  return (
    await engine.query<any>(
      "SELECT * FROM cazoo_lead_receipts WHERE provider_id=$1",
      [id],
    )
  ).rows[0];
}
async function queue(id = randomUUID(), to = [address]) {
  await acceptCazooLeadEvent({
    type: "email.received",
    data: { email_id: id, to },
  });
  return id;
}
process.env.MULTI_TENANT_ENABLED = "true";
process.env.CAZOO_LEADS_ENABLED = "true";
process.env.CAZOO_LEAD_MAILBOXES = JSON.stringify({
  "cazoo-a": address,
  "cazoo-b": second,
});
process.env.RESEND_RECEIVING_API_KEY = "re_fictional_receiver";
process.env.CAZOO_LEADS_WEBHOOK_SECRET =
  "whsec_" + randomBytes(32).toString("base64");
const draftSkip = async () => "skipped" as const;
function transportFor(payloads: Record<string, any>): typeof fetch {
  return async (url, options) => {
    assert.equal(options?.redirect, "error");
    const id = /receiving\/([^?]+)/.exec(String(url))?.[1];
    assert.ok(
      id && payloads[id],
      "Only expected receiving API calls are allowed; never send email or follow email URLs",
    );
    return new Response(JSON.stringify(payloads[id!]), { status: 200 });
  };
}
test.after(() => engine.close());
test("parser extracts the customer section from text and HTML", () => {
  const parsed = parseCazooLead(email());
  assert.equal(parsed.email, "sam@example.test");
  assert.equal(parsed.phone, "07400000000");
  assert.equal(parsed.customerName, "Sam Example");
  assert.equal(parsed.registration, "AB15CDE");
  assert.equal(parsed.message, "Do you accept px for a Lexus GS450h 2008?");
  const html = text()
    .split("\n")
    .map((line) => `<p>${line}</p>`)
    .join("");
  assert.equal(
    parseCazooLead(email(undefined, { text: null, html })).email,
    parsed.email,
  );
});
test("spoofing and ambiguous templates are rejected", () => {
  for (const extra of [
    { from: "attacker@example.test" },
    { authentication: null },
    { authentication: { dmarc: "fail" } },
    { subject: "Fwd: Enquiry - Lexus RX AB15CDE - sam" },
    {
      text: text().replace(
        "sam@example.test",
        "sam@example.test\nother@example.test",
      ),
    },
    { text: text() + "\nCorrelationID: " + "b".repeat(32) },
    { text: "Customer message\nUnknown format" },
  ])
    assert.throws(() => parseCazooLead(email(undefined, extra)));
  assert.equal(
    parseCazooLead(
      email(undefined, {
        text: text().replace("07400000000", "+44 7400 000000"),
      }),
    ).phone,
    "07400000000",
  );
});
test("missing leading zero is restored only for ten-digit UK mobile leads and owner forwards stay private", () => {
  const mobileLead = text().replace("07400000000", "7700900123");
  assert.equal(parseCazooLead(email(undefined, { text: mobileLead })).phone, "07700900123");
  for (const invalid of ["1700900123", "770090012", "77009001234"]) {
    const parsed = parseCazooLead(email(undefined, { text: text().replace("07400000000", invalid) }));
    assert.equal(parsed.phone, null);
    assert.deepEqual(parsed.contactWarnings, ["phone_needs_checking"]);
  }
  const previous = process.env.CAZOO_OWNER_TEST_SENDERS;
  const owner = "owner@example.test";
  process.env.CAZOO_OWNER_TEST_SENDERS = JSON.stringify({
    "cazoo-a": { email: owner, expiresAt: new Date(Date.now() + 86400000).toISOString() },
  });
  try {
    for (const forwarded of [mobileLead, text().replace("07400000000", "Tel: 07400")]) {
      const result = parseCazooDelivery("cazoo-a", email(undefined, {
        from: `Owner <${owner}>`,
        subject: "Fwd: Enquiry - Lexus RX AB15CDE - sam",
        text: "---------- Forwarded message ---------\n" + forwarded,
      }));
      assert.equal(result.testDelivery, true);
      assert.equal(result.lead.phone, null);
      assert.equal(result.lead.email, owner);
      assert.equal(result.lead.customerName, "Owner test");
      assert.equal(result.lead.message, "Do you accept px for a Lexus GS450h 2008?");
      assert.ok(!(JSON.stringify(result.lead.contactWarnings) || "").includes("07400"));
    }
  } finally {
    if (previous === undefined) delete process.env.CAZOO_OWNER_TEST_SENDERS;
    else process.env.CAZOO_OWNER_TEST_SENDERS = previous;
  }
});
test("common UK phone formatting is repaired without inventing digits", () => {
  for (const phone of [
    "07400 000000", "+44 7400 000000", "0044 7400 000000", "447400000000",
    "+44 (0) 7400 000000", "0044 (0) 7400 000000", "7400000000",
    "(07400) 000.000", "07400–000000", "Mobile: +44\u00a07400\u202f000000",
    "07400000000\n+44 7400 000000",
  ]) {
    const parsed = parseCazooLead(email(undefined, {text: text().replace("07400000000", phone)}));
    assert.equal(parsed.phone, "07400000000", phone);
    assert.equal(parsed.customerName, "Sam Example");
    assert.equal(parsed.contactWarnings, undefined);
  }
});
test("optional bad, missing and conflicting phones do not hide an otherwise usable email lead", () => {
  for (const phone of [
    "07400", "00000000000", "+33 612345678", "Phone: N/A", "Tel: please email", "07400000000 ext. 123",
    "07400000000\n07500000000", "07400000000\n123456",
  ]) {
    const parsed = parseCazooLead(email(undefined, {text: text().replace("07400000000", phone)}));
    assert.equal(parsed.phone, null, phone);
    assert.equal(parsed.email, "sam@example.test");
    assert.equal(parsed.customerName, "Sam Example");
    assert.deepEqual(parsed.contactWarnings, ["phone_needs_checking"]);
  }
  const missing = parseCazooLead(email(undefined, {text: text().replace("07400000000\n", "")}));
  assert.equal(missing.phone, null);
  assert.equal(missing.contactWarnings, undefined);
});
test("copying whitespace and an absent name are tolerated but unsafe or conflicting contacts remain held", () => {
  const parsed = parseCazooLead(email(undefined, {
    subject: "Enquiry - Lexus RX AB15  CDE - sam",
    text: text().replace("Customer message", "Customer\u00a0message").replace("Customer details", "Customer\u202fdetails")
      .replace("Sam Example\n", "").replace("sam@example.test", "Email: SAM@EXAMPLE.TEST\u200b"),
  }));
  assert.equal(parsed.registration, "AB15CDE");
  assert.equal(parsed.customerName, "Customer");
  assert.equal(parsed.email, "sam@example.test");
  assert.deepEqual(parsed.contactWarnings, ["customer_name_missing"]);
  for (const space of ["\u00a0", "\u202f", "\t"]) {
    assert.equal(parseCazooLead(email(undefined, {subject: `Enquiry - Lexus RX AB15${space}CDE - sam`})).registration, "AB15CDE");
  }
  for (const body of [
    text().replace("sam@example.test", "not-an-email"),
    text().replace("sam@example.test", "sam@example.test\nother@example.test"),
    text().replace("sam@example.test", "Email: sam@example.test\nEmail: other@example.test"),
    text().replace("Sam Example", "Sam <script>"),
    text().replace("Sam Example", "Sam\nother@bad"),
  ]) assert.throws(() => parseCazooLead(email(undefined, {text: body})));
});
test("durable receiving imports once, scopes dealers and never sends", async (t) => {
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + file, "utf8"));
  await engine.exec(
    "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES ('cazoo-a','Fictional A','active','https://a.example.test','cazoo','fake','https://www.cazoo.co.uk/fake'),('cazoo-b','Fictional B','active','https://b.example.test','cazoo','fake','https://www.cazoo.co.uk/fake')",
  );
  await engine.query(
    "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,registration,source_price) VALUES($1,'cazoo-a','cazoo','fake-a','Lexus RX','AB15 CDE',9500),($2,'cazoo-b','cazoo','fake-b','Other dealer car','AB15CDE',12000)",
    [carId, otherCarId],
  );
  await engine.query(
    "INSERT INTO dealer_settings(dealer_id,config) VALUES('cazoo-a',$1::jsonb)",
    [
      JSON.stringify({
        identity: { name: "Fictional A" },
        partExchange: { enabled: true },
      }),
    ],
  );
  await engine.exec("INSERT INTO dealer_demos(dealer_id,recipient,expires_at,updated_by,converted_at) VALUES('cazoo-a','owner@example.test',now()+interval '7 days','fixture',now())");
  const first = await queue();
  await t.test(
    "unmapped and mixed recipients cannot pick a dealership",
    async () => {
      const bad = await queue(undefined, [address, second]),
        unknown = await queue(undefined, ["unknown@example.test"]);
      assert.equal(await receipt(bad), undefined);
      assert.equal(await receipt(unknown), undefined);
      const before = process.env.CAZOO_LEAD_MAILBOXES;
      process.env.CAZOO_LEAD_MAILBOXES = JSON.stringify({
        a: address,
        b: address,
      });
      assert.deepEqual(cazooLeadMailboxes(), {});
      process.env.CAZOO_LEAD_MAILBOXES = before;
    },
  );
  await t.test(
    "valid lead becomes an enquiry and marketplace sales lead",
    async () => {
      await processCazooLeads(
        transportFor({ [first]: email(first) }),
        draftSkip,
      );
      const r = await receipt(first);
      assert.equal(r.status, "imported");
      const entry = (
        await engine.query<any>("SELECT * FROM enquiries WHERE id=$1", [
          r.enquiry_id,
        ])
      ).rows[0];
      assert.equal(entry.email, "sam@example.test");
      assert.equal(entry.vehicle_id, carId);
      assert.equal(entry.source, "cazoo");
      assert.equal(entry.customer_notification_status, "not_sent");
      assert.equal(
        (
          await engine.query<any>(
            "SELECT source FROM leads WHERE enquiry_id=$1",
            [r.enquiry_id],
          )
        ).rows[0].source,
        "marketplace",
      );
    },
  );
  await t.test(
    "provider retries and correlation duplicates cannot duplicate an enquiry",
    async () => {
      await queue(first);
      const duplicate = await queue();
      await processCazooLeads(
        transportFor({ [duplicate]: email(duplicate) }),
        draftSkip,
      );
      assert.equal((await receipt(duplicate)).status, "duplicate");
      assert.equal(
        (
          await engine.query<any>(
            "SELECT count(*)::int AS n FROM enquiries WHERE dealer_id='cazoo-a'",
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await t.test(
    "unusable optional contact details still reach the Inbox with safe private notes and no send",
    async () => {
      const provider = await queue();
      const invalidPhone = "07400";
      await processCazooLeads(transportFor({
        [provider]: email(provider, {text: text("e".repeat(32)).replace("07400000000", invalidPhone).replace("Sam Example\n", "")}),
      }), draftSkip);
      const r = await receipt(provider);
      assert.equal(r.status, "imported");
      assert.equal(r.review_text, null);
      const entry = (await engine.query<any>("SELECT * FROM enquiries WHERE id=$1", [r.enquiry_id])).rows[0];
      assert.equal(entry.email, "sam@example.test");
      assert.equal(entry.phone, null);
      assert.equal(entry.customer_name, "Customer");
      assert.equal(entry.vehicle_id, carId);
      assert.match(entry.staff_note, /phone number.*left blank/);
      assert.match(entry.staff_note, /did not supply a customer name/);
      assert.ok(!entry.staff_note.includes(invalidPhone));
      assert.equal(entry.customer_notification_status, "not_sent");
      assert.equal((await engine.query<any>("SELECT count(*)::int AS n FROM email_outbox")).rows[0].n, 0);
    },
  );
  await t.test(
    "AI draft is budgeted, targets customer and never replaces an existing draft",
    async () => {
      process.env.AI_ASSISTANCE_ENABLED = "true";
      process.env.OPENAI_API_KEY = "fictional-test-only";
      const r = await receipt(first);
      let calls = 0;
      const generated = async (_task: any, _question: string, facts: any) => {
        calls++;
        assert.equal(facts.dealer.identity.name, "Fictional A");
        assert.ok(!JSON.stringify(facts).includes("sam@example.test"));
        return {
          result: {
            answer:
              "Hi, please send your registration and mileage so we can discuss part exchange.",
            vehicleIds: [],
            questions: [],
            evidence: [carId],
          },
          cost: 1,
        };
      };
      const getCar = async () => ({
        id: carId,
        make: "Lexus",
        model: "RX",
        inventoryStatus: "available",
      });
      assert.equal(
        await runWithTenant(tenant(), () =>
          draftCazooReply(r, generated, getCar),
        ),
        "ready",
      );
      assert.equal(
        await runWithTenant(tenant(), () =>
          draftCazooReply(r, generated, getCar),
        ),
        "skipped",
      );
      assert.equal(calls, 1);
      const draft = (
        await engine.query<any>(
          "SELECT * FROM enquiry_email_drafts WHERE enquiry_id=$1",
          [r.enquiry_id],
        )
      ).rows[0];
      assert.equal(draft.content.to, "sam@example.test");
      assert.equal(draft.status, "draft");
      assert.equal(draft.source, "ai");
      assert.equal(
        (await engine.query<any>("SELECT count(*)::int AS n FROM email_outbox"))
          .rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "bad layouts stay visible and missing vehicles never match another dealer",
    async () => {
      const bad = await queue(),
        unmatched = await queue();
      await processCazooLeads(
        transportFor({
          [bad]: email(bad, { text: "A changed email layout" }),
          [unmatched]: email(unmatched, {
            subject: "Enquiry - Ford Focus ZZ99ZZZ - sam",
            text: text("c".repeat(32)),
          }),
        }),
        draftSkip,
      );
      assert.equal((await receipt(bad)).status, "review");
      assert.equal((await receipt(bad)).review_text, "A changed email layout");
      const r = await receipt(unmatched);
      assert.equal(r.status, "imported");
      assert.equal(r.error_code, "vehicle_not_matched");
      assert.equal(
        (
          await engine.query<any>(
            "SELECT vehicle_id FROM enquiries WHERE id=$1",
            [r.enquiry_id],
          )
        ).rows[0].vehicle_id,
        null,
      );
    },
  );
  await t.test(
    "failed retrievals retry and abandoned leases recover",
    async () => {
      const provider = await queue();
      await processCazooLeads(
        async () => new Response("unavailable", { status: 503 }),
        draftSkip,
      );
      assert.equal((await receipt(provider)).status, "pending");
      await engine.query(
        "UPDATE cazoo_lead_receipts SET status='processing',lease_until=now()-interval '1 minute',next_attempt_at=now() WHERE provider_id=$1",
        [provider],
      );
      await processCazooLeads(
        transportFor({
          [provider]: email(provider, { text: text("d".repeat(32)) }),
        }),
        draftSkip,
      );
      assert.equal((await receipt(provider)).status, "imported");
      const exhausted = await queue();
      await engine.query(
        "UPDATE cazoo_lead_receipts SET status='processing',attempts=8,lease_until=now()-interval '1 minute' WHERE provider_id=$1",
        [exhausted],
      );
      await processCazooLeads(transportFor({}), draftSkip);
      assert.equal((await receipt(exhausted)).status, "review");
    },
  );
  await t.test(
    "connection review and retry controls require staff and remain dealer scoped",
    async () => {
      const review = await queue();
      await engine.query(
        "UPDATE cazoo_lead_receipts SET status='review',error_code='unrecognised_subject' WHERE provider_id=$1",
        [review],
      );
      const row = await receipt(review);
      const app = express();
      app.use((req, _res, next) =>
        runWithTenant(
          tenant(req.get("x-fixture-dealer") === "b" ? "cazoo-b" : "cazoo-a"),
          () => {
            if (req.get("x-fixture-role"))
              req.staff = {
                authUserId: "fictional-owner",
                email: "owner@example.test",
                name: "Fixture",
                role:
                  req.get("x-fixture-role") === "owner" ? "owner" : "accounts",
                permissions:
                  req.get("x-fixture-role") === "owner" ? ["sales.manage"] : [],
              };
            next();
          },
        ),
      );
      app.use("/api", createCazooLeadRouter());
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const url = `http://127.0.0.1:${(server.address() as any).port}/api/staff/cazoo-leads`;
      try {
        assert.equal((await fetch(url)).status, 401);
        assert.equal(
          (await fetch(url, { headers: { "x-fixture-role": "viewer" } }))
            .status,
          403,
        );
        const response = await fetch(url, {
          headers: { "x-fixture-role": "owner", "x-fixture-dealer": "b" },
        });
        assert.equal(response.status, 200);
        const data = (await response.json()) as any;
        assert.equal(data.mailbox, second);
        assert.deepEqual(data.receipts, []);
        assert.equal(
          (
            await fetch(url + `/${row.id}/retry`, {
              method: "POST",
              headers: { "x-fixture-role": "owner", "x-fixture-dealer": "b" },
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await fetch(url + `/${row.id}/retry`, {
              method: "POST",
              headers: {
                "x-fixture-role": "owner",
                origin: "https://evil.example.test",
              },
            })
          ).status,
          403,
        );
        assert.equal((await receipt(review)).status, "review");
        assert.equal(
          (
            await fetch(url + `/${row.id}/retry`, {
              method: "POST",
              headers: { "x-fixture-role": "owner" },
            })
          ).status,
          200,
        );
        assert.equal((await receipt(review)).status, "pending");
        // Leave no pending provider work for later subtests.
        await engine.query(
          "UPDATE cazoo_lead_receipts SET status='review' WHERE provider_id=$1",
          [review],
        );
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
  await t.test(
    "webhook requires a valid signature and enabled connection",
    async () => {
      const app = express();
      app.use("/webhook", createCazooLeadWebhook());
    app.use("/shared", createCustomerEmailWebhook());
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const origin = `http://127.0.0.1:${(server.address() as any).port}`;
      try {
        const provider = randomUUID(),
          body = JSON.stringify({
            type: "email.received",
            data: { email_id: provider, to: [address] },
          });
        assert.equal(
          (
            await fetch(origin + "/webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            })
          ).status,
          401,
        );
        const date = new Date(),
          id = "msg_fixture",
          signature = new Webhook(process.env.CAZOO_LEADS_WEBHOOK_SECRET!).sign(
            id,
            date,
            body,
          );
        assert.equal(
          (
            await fetch(origin + "/webhook", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "svix-id": id,
                "svix-timestamp": String(Math.floor(date.getTime() / 1000)),
                "svix-signature": signature,
              },
              body,
            })
          ).status,
          200,
        );
        assert.ok(await receipt(provider));
      process.env.RESEND_RECEIVING_WEBHOOK_SECRET = process.env.CAZOO_LEADS_WEBHOOK_SECRET;
      const sharedProvider = randomUUID(), sharedBody = JSON.stringify({ type: "email.received", data: { email_id: sharedProvider, to: [address] } });
      const sharedSignature = new Webhook(process.env.RESEND_RECEIVING_WEBHOOK_SECRET!).sign(id, date, sharedBody);
      assert.equal((await fetch(origin + "/shared", { method: "POST", headers: { "Content-Type": "application/json", "svix-id": id, "svix-timestamp": String(Math.floor(date.getTime() / 1000)), "svix-signature": sharedSignature }, body: sharedBody })).status, 200);
      assert.ok(await receipt(sharedProvider));

        process.env.CAZOO_LEADS_ENABLED = "false";
        assert.equal(
          (
            await fetch(origin + "/webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body,
            })
          ).status,
          503,
        );
        process.env.CAZOO_LEADS_ENABLED = "true";
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});


test("owner testing is exact, temporary, authenticated and cannot consume a genuine correlation", async () => {
  const now = Date.now(), owner = "owner@example.test";
  process.env.CAZOO_OWNER_TEST_SENDERS = JSON.stringify({ "cazoo-a": { email: owner, expiresAt: new Date(now + 7 * 86400000).toISOString() } });
  try {
    assert.equal(cazooTestSender("cazoo-a", now)?.email, owner);
    assert.equal(cazooTestSender("cazoo-b", now), null);
    assert.equal(cazooTestSender("cazoo-a", now + 8 * 86400000), null);
    const id = randomUUID(), forwarded = email(id, { from: `Owner <${owner}>`, subject: "Fwd: Enquiry - Lexus RX AB15CDE - sam", text: "Previous dealer reply: we can accept £5,000.\n---------- Forwarded message ---------\n" + text().split("\n").map(line => "> " + line).join("\n") });
    const parsed = parseCazooDelivery("cazoo-a", forwarded, now);
    assert.equal(parsed.testDelivery, true);
    assert.equal(parsed.lead.email, owner);
    assert.equal(parsed.lead.customerName, "Owner test");
    assert.equal(parsed.lead.phone, null);
    assert.equal(parsed.lead.registration, "AB15CDE");
    assert.equal(parsed.lead.message, "Do you accept px for a Lexus GS450h 2008?");
    assert.notEqual(parsed.lead.correlationId, "a".repeat(32));
    assert.equal(parseCazooDelivery("cazoo-a", forwarded, now).lead.correlationId, parsed.lead.correlationId);
    for (const change of [{ from: "other@example.test" }, { from: "owner@example.test.attacker.test" }, { authentication: null }, { authentication: { dmarc: "fail" } }])
      assert.throws(() => parseCazooDelivery("cazoo-a", {...forwarded,...change}, now));
    assert.throws(() => parseCazooDelivery("cazoo-b", forwarded, now));
    assert.throws(() => parseCazooDelivery("cazoo-a", forwarded, now + 8 * 86400000));
    assert.equal(parseCazooDelivery("cazoo-a", email(), now).testDelivery, false);
    const simple = parseCazooDelivery("cazoo-a", {...forwarded, subject:"Enquiry - Lexus RX AB15CDE - Test", text:"Is it available for a viewing tomorrow?"}, now);
    assert.equal(simple.lead.message, "Is it available for a viewing tomorrow?");
    assert.throws(() => parseCazooDelivery("cazoo-a", {...forwarded, text: text() + "\n" + text("b".repeat(32))}, now));
    assert.throws(() => parseCazooDelivery("cazoo-a", {...forwarded, subject:"Hello", text:"A plain test with no car reference"}, now));

    await queue(id);
    await processCazooLeads(transportFor({[id]:forwarded}), draftSkip);
    const receiptRow = await receipt(id);
    assert.equal(receiptRow.status,"imported");
    assert.equal(receiptRow.error_code,"owner_test");
    const enquiry = (await engine.query<any>("SELECT * FROM enquiries WHERE id=$1", [receiptRow.enquiry_id])).rows[0];
    assert.equal(enquiry.vehicle_id,carId);
    assert.equal(enquiry.email,owner);
    assert.equal(enquiry.phone,null);
    assert.match(enquiry.staff_note,/Owner test/);
    assert.notEqual(receiptRow.correlation_id,"a".repeat(32));
    const generated = async () => ({result:{answer:"Hi, we accept part exchange. Please share your registration and current mileage.",vehicleIds:[],questions:[],evidence:[carId]},cost:1});
    assert.equal(await runWithTenant(tenant(),()=>draftCazooReply(receiptRow,generated,async()=>({id:carId,make:"Lexus",model:"RX",inventoryStatus:"available"}))),"ready");
    const draft = (await engine.query<any>("SELECT content FROM enquiry_email_drafts WHERE enquiry_id=$1",[receiptRow.enquiry_id])).rows[0];
    assert.equal(draft.content.to,owner);
    assert.ok(!JSON.stringify(draft.content).includes("sam@example.test"));
    assert.equal((await engine.query<any>("SELECT count(*)::int AS n FROM email_outbox")).rows[0].n,0);
  } finally { delete process.env.CAZOO_OWNER_TEST_SENDERS; }
});
