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
import { cazooAutomaticReplyOptedIn, enquiryAiAutomationEligibility, enquiryAiAutomationOptIns } from "./lib/enquiry-ai-automation";
import {
  acceptCazooLeadEvent,
  cazooLeadMailboxes,
  cazooDraftAutomationEligibility,
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
process.env.AI_ENQUIRY_AUTOMATION = JSON.stringify({
  "cazoo-a": { provider: "cazoo", enabled: true },
});
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
const automationEvidence = () => ({
  dealerActive: true,
  demo: false,
  provider: "cazoo" as const,
  optIn: { provider: "cazoo" as const, enabled: true },
  aiAvailable: true,
  stock: { provider: "cazoo", enabled: true, verified: true },
  dedicatedMailbox: { provider: "cazoo" as const, connected: true },
});
test("background AI opt-ins are explicit, exact and fail closed", () => {
  const valid = { "cazoo-a": { provider: "cazoo", enabled: true } };
  assert.deepEqual(enquiryAiAutomationOptIns({ AI_ENQUIRY_AUTOMATION: JSON.stringify(valid) }), valid);
  assert.equal(enquiryAiAutomationOptIns({ AI_ENQUIRY_AUTOMATION: JSON.stringify(valid) })["cazoo-b"], undefined);
  for (const input of ["", "no json", "[]", "null", JSON.stringify({ "*": valid["cazoo-a"] }), JSON.stringify({ "cazoo-a": { provider: "cazoo", enabled: "true" } }), JSON.stringify({ "cazoo-a": { provider: "other", enabled: true } }), JSON.stringify({ "cazoo-a": { provider: "cazoo", enabled: true, autoSend: true } }), "x".repeat(65537)])
    assert.deepEqual(enquiryAiAutomationOptIns({ AI_ENQUIRY_AUTOMATION: input }), {});
});
test("automatic replies require the exact dealer and only apply from activation", () => {
  const activation = "2026-01-01T00:00:00.000Z";
  const valid = JSON.stringify({ "cazoo-a": activation, "cazoo-b": activation });
  const optIn = (value: string | undefined, dealer = "cazoo-a", receivedAt?: Date) =>
    cazooAutomaticReplyOptedIn(dealer, { AI_CAZOO_AUTOMATIC_REPLY_DEALERS: value }, receivedAt);
  assert.equal(optIn(valid), true);
  assert.equal(optIn(valid, "cazoo-aa"), false);
  assert.equal(optIn(valid, "Cazoo-a"), false);
  assert.equal(optIn(valid, "cazoo-a", new Date(activation)), true);
  assert.equal(optIn(valid, "cazoo-a", new Date(Date.parse(activation) - 1)), false);
  assert.equal(optIn(valid, "cazoo-a", new Date("invalid")), false);
  for (const value of [undefined, "", "no json", "null", "true", '["cazoo-a"]', '{"*":"2026-01-01T00:00:00.000Z"}', '{"cazoo-a":true}', '{"cazoo-a":"2026-01-01"}', '{"cazoo-a":"invalid"}', '{"cazoo-a":"2999-01-01T00:00:00.000Z"}', "x".repeat(65537)])
    assert.equal(optIn(value), false);
});
test("automatic first replies need draft eligibility, a separate send opt-in and outbound readiness", () => {
  const evidence = { ...automationEvidence(), automaticReplyOptIn: true, automaticReplyDeliveryAvailable: true };
  const result = enquiryAiAutomationEligibility(evidence);
  assert.equal(result.automaticDraftsEnabled, true);
  assert.equal(result.automaticRepliesEnabled, true);
  assert.equal(result.mode, "automatic_reply");
  assert.deepEqual(result.replyBlockers, []);
  const noOptIn = enquiryAiAutomationEligibility({ ...evidence, automaticReplyOptIn: false });
  assert.equal(noOptIn.automaticRepliesEnabled, false);
  assert.equal(noOptIn.mode, "draft_only");
  assert.deepEqual(noOptIn.replyBlockers, ["automatic_reply_not_enabled"]);
  const noDelivery = enquiryAiAutomationEligibility({ ...evidence, automaticReplyDeliveryAvailable: false });
  assert.equal(noDelivery.automaticRepliesEnabled, false);
  assert.equal(noDelivery.mode, "draft_only");
  assert.deepEqual(noDelivery.replyBlockers, ["automatic_reply_delivery_unavailable"]);
});
test("Cazoo stock alone never enables background AI and every gate is required", () => {
  const evidence = automationEvidence();
  const eligible = enquiryAiAutomationEligibility(evidence);
  assert.equal(eligible.automaticDraftsEnabled, true);
  assert.equal(eligible.mode, "draft_only");
  assert.equal(eligible.automaticRepliesEnabled, false);
  const denied = [
    { ...evidence, optIn: undefined },
    { ...evidence, optIn: { provider: "cazoo" as const, enabled: false } },
    { ...evidence, optIn: { provider: "autotrader" as const, enabled: true } },
    { ...evidence, aiAvailable: false },
    { ...evidence, dealerActive: false },
    { ...evidence, demo: true },
    { ...evidence, stock: { ...evidence.stock, enabled: false } },
    { ...evidence, stock: { ...evidence.stock, verified: false } },
    { ...evidence, stock: { ...evidence.stock, provider: "autotrader" } },
    { ...evidence, dedicatedMailbox: { ...evidence.dedicatedMailbox, connected: false } },
    { ...evidence, dedicatedMailbox: { provider: "autotrader" as const, connected: true } },
  ];
  for (const input of denied) {
    const result = enquiryAiAutomationEligibility({ ...input, automaticReplyOptIn: true, automaticReplyDeliveryAvailable: true });
    assert.equal(result.automaticDraftsEnabled, false);
    assert.equal(result.mode, "manual");
    assert.equal(result.automaticRepliesEnabled, false);
    assert.ok(result.blockers.length);
  }
});
test("future Auto Trader opt-ins cannot claim an implemented adapter or send loop", () => {
  const result = enquiryAiAutomationEligibility({
    ...automationEvidence(),
    provider: "autotrader",
    optIn: { provider: "autotrader", enabled: true },
    stock: { provider: "autotrader", enabled: true, verified: true },
    dedicatedMailbox: { provider: "autotrader", connected: true },
    automaticReplyOptIn: true,
    automaticReplyDeliveryAvailable: true,
  });
  assert.equal(result.automaticDraftsEnabled, false);
  assert.equal(result.automaticRepliesEnabled, false);
  assert.deepEqual(result.blockers, ["provider_unavailable"]);
});
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
    "INSERT INTO stock_import_runs(run_id,dealer_id,source,retailer_id,schema_version,scraped_at,expected_count,received_count,complete,status,raw_snapshot) VALUES($1,'cazoo-a','cazoo','fake','1',now(),1,1,true,'completed','{}'::jsonb)",
    [randomUUID()],
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
  await t.test("Cazoo's repeated linked contact values import and absent email stays actionable in Inbox", async () => {
    const repeated = await queue();
    const phoneOnly = await queue();
    const contactMissing = await queue();
    const bodyWithoutEmail = (reference: string) => text(reference).replace("sam@example.test\n", "");
    const blankAvailability = (body: string) => body
      .replace("Do you accept px for a Lexus GS450h 2008?", "\n")
      .replace("Enquiry type\nQuestion", "Enquiry type\n\nAvailability\n");
    const adjacentHeaders = text().replace(
      "Customer message\nDo you accept px for a Lexus GS450h 2008?\nEnquiry type\nQuestion",
      "Customer message\nEnquiry type\nAvailability",
    );
    assert.match(parseCazooLead(email(undefined, { text: adjacentHeaders })).message, /Cazoo availability enquiry/);
    assert.throws(() => parseCazooLead(email(undefined, {
      text: text().replace("Do you accept px for a Lexus GS450h 2008?", ""),
    })), { code: "invalid_customer_message" });
    await processCazooLeads(transportFor({
      [repeated]: email(repeated, { text: blankAvailability(text("4".repeat(32)))
        .replace("sam@example.test", "sam@example.test ( SAM@EXAMPLE.TEST )")
        .replace("07400000000", "07400 000000 ( tel:07400000000 )") }),
      [phoneOnly]: email(phoneOnly, { text: bodyWithoutEmail("5".repeat(32)) }),
      [contactMissing]: email(contactMissing, { text: blankAvailability(bodyWithoutEmail("6".repeat(32)).replace("07400000000\n", "")) }),
    }), draftSkip);
    for (const [id, expectedEmail, expectedPhone, expectedContact] of [
      [repeated, "sam@example.test", "07400000000", "email"],
      [phoneOnly, null, "07400000000", "phone"],
      [contactMissing, null, null, null],
    ]) {
      const r = await receipt(id!);
      assert.equal(r.status, "imported");
      const entry = (await engine.query<any>("SELECT * FROM enquiries WHERE id=$1", [r.enquiry_id])).rows[0];
      assert.equal(entry.email, expectedEmail);
      assert.equal(entry.phone, expectedPhone);
      assert.equal(entry.preferred_contact, expectedContact);
      assert.equal(entry.customer_notification_status, "not_sent");
      if (id !== phoneOnly) assert.match(entry.message, /Cazoo availability enquiry.*did not add a written message/);
      if (!expectedEmail) {
        assert.equal(r.error_code, "customer_email_missing");
        assert.equal(r.draft_status, "skipped");
        assert.match(entry.staff_note, /did not supply a customer email address/);
      }
    }
    assert.equal((await engine.query<any>("SELECT count(*)::int AS n FROM email_outbox")).rows[0].n, 0);
  });
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
      const optedIn = process.env.AI_ENQUIRY_AUTOMATION;
      delete process.env.AI_ENQUIRY_AUTOMATION;
      try {
        assert.equal(await runWithTenant(tenant(), () => draftCazooReply(r, generated, getCar)), "skipped");
        assert.equal(calls, 0, "No paid AI request without this dealer's explicit opt-in");
        assert.ok((await cazooDraftAutomationEligibility("cazoo-a")).blockers.includes("not_enabled"));
      } finally { process.env.AI_ENQUIRY_AUTOMATION = optedIn; }
      assert.equal((await cazooDraftAutomationEligibility("cazoo-a", second)).automaticDraftsEnabled, false);
      assert.equal((await cazooDraftAutomationEligibility("cazoo-b")).automaticDraftsEnabled, false);
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
  await t.test("official Cazoo stock takes precedence and requires a matching applied import", async () => {
    const runId = "cazoo-csv:cazoo-a:fixture";
    await engine.exec("INSERT INTO cazoo_feed_authority(dealer_id,retailer_id,feed_id,enabled) VALUES('cazoo-a','fake','AETA1',true)");
    try {
      assert.equal((await cazooDraftAutomationEligibility("cazoo-a")).automaticDraftsEnabled, false);
      await engine.query(
        "INSERT INTO stock_import_runs(run_id,dealer_id,source,retailer_id,schema_version,scraped_at,expected_count,received_count,complete,status,raw_snapshot) VALUES($1,'cazoo-a','cazoo','fake','1',now(),1,1,true,'completed','{}'::jsonb)",
        [runId],
      );
      assert.equal((await cazooDraftAutomationEligibility("cazoo-a")).automaticDraftsEnabled, true);
      await engine.exec("UPDATE cazoo_feed_authority SET enabled=false WHERE dealer_id='cazoo-a'");
      assert.equal((await cazooDraftAutomationEligibility("cazoo-a")).automaticDraftsEnabled, false);
      await engine.exec("UPDATE cazoo_feed_authority SET enabled=true,retailer_id='other' WHERE dealer_id='cazoo-a'");
      assert.equal((await cazooDraftAutomationEligibility("cazoo-a")).automaticDraftsEnabled, false);
    } finally {
      await engine.query("DELETE FROM stock_import_runs WHERE run_id=$1", [runId]);
      await engine.exec("DELETE FROM cazoo_feed_authority WHERE dealer_id='cazoo-a'");
    }
  });
  await t.test("background drafts share verified MOT context/audit and archived cases make no calls", async () => {
    const provider = await queue();
    await processCazooLeads(transportFor({ [provider]: email(provider, { text: text("f".repeat(32)).replace("Do you accept px for a Lexus GS450h 2008?", "What is the MOT expiry and any advisories? Does it have pqrking sensors, what is reg?") }) }), draftSkip);
    const row = await receipt(provider);
    let generated = 0, lookedUp = 0;
    const getCar = async () => ({ id: carId, registration: "AB15CDE", make: "Lexus", model: "RX", inventoryStatus: "available", features: [], specifications: { features: ["Rear parking sensors"] } });
    const lookup = async (registration: string) => { lookedUp++; assert.equal(registration, "AB15CDE"); return { registration, make: "Lexus", model: "RX", checkedAt: new Date().toISOString(), recall: "Unknown" as const, tests: [{ completedDate: "2026-01-01", result: "PASSED" as const, expiryDate: "2027-01-01", mileage: "50000", mileageUnit: "MI" as const, defects: [{ text: "Tyre worn", type: "ADVISORY", dangerous: false }] }] }; };
    const generate = async (_task: any, _question: string, facts: any) => {
      generated++;
      assert.equal(facts.cars[0].mot.latest.result, "PASSED");
      assert.deepEqual(facts.cars[0].features, ["Rear parking sensors"]);
      assert.ok(facts.verification.questions.some((check: any) => check.topic === "registration"));
      return { result: { answer: "The recorded MOT expiry is 1 January 2027 and it lists a tyre advisory. Rear parking sensors are listed. The registration is AB15CDE.", vehicleIds: [], questions: [], evidence: [carId] }, cost: 1 };
    };
    await engine.query("UPDATE enquiries SET archived_at=now(),archive_delete_at=now()+interval '30 days' WHERE id=$1", [row.enquiry_id]);
    assert.equal(await runWithTenant(tenant(), () => draftCazooReply(row, generate, getCar, lookup)), "skipped");
    assert.equal(lookedUp, 0);
    assert.equal(generated, 0);
    await engine.query("UPDATE enquiries SET archived_at=NULL,archive_delete_at=NULL WHERE id=$1", [row.enquiry_id]);
    assert.equal(await runWithTenant(tenant(), () => draftCazooReply(row, generate, getCar, lookup)), "ready");
    assert.equal(lookedUp, 1);
    assert.equal(generated, 1);
    const audit = (await engine.query<any>("SELECT context_audit FROM ai_assistance_requests WHERE dealer_id='cazoo-a' AND request_id=$1", [row.id])).rows[0].context_audit;
    assert.equal(audit.enquiryId, row.enquiry_id);
    assert.equal(audit.lookups[0].status, "verified");
    assert.ok(!JSON.stringify(audit).includes("sam@example.test"));
    assert.equal((await engine.query<any>("SELECT count(*)::int AS n FROM email_outbox")).rows[0].n, 0);
  });
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
        assert.equal(data.automation.automaticDraftsEnabled, false);
        assert.equal(data.automation.automaticRepliesEnabled, false);
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
  await t.test("owners can configure forwarding and recover a verified receipt without reimporting", async () => {
    const review = await queue();
    const original = email(review, { text: text("1".repeat(32)).replace("sam@example.test", "sam@example.test ( another@example.test )") });
    await processCazooLeads(transportFor({ [review]: original }), draftSkip);
    const before = await receipt(review);
    assert.equal(before.error_code, "missing_or_ambiguous_customer_email");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => runWithTenant(tenant(req.get("x-fixture-dealer") === "b" ? "cazoo-b" : "cazoo-a"), () => {
      req.staff = {
        authUserId: "fictional-staff", email: "owner@example.test", name: "Fixture",
        role: req.get("x-fixture-role") === "owner" ? "owner" : "salesperson",
      };
      next();
    }));
    app.use("/api", createCazooLeadRouter(async id => {
      assert.equal(id, review);
      return { ...original, attachments: [] };
    }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/api/staff/cazoo-leads`;
    const owner = { "x-fixture-role": "owner", "Content-Type": "application/json" };
    const save = (recipient: string, headers: Record<string, string> = owner) =>
      fetch(url + "/forwarding", { method: "PUT", headers, body: JSON.stringify({ enabled: true, recipient }) });
    const forward = (headers: Record<string, string> = owner) =>
      fetch(url + `/${before.id}/forward`, { method: "POST", headers });
    try {
      assert.equal((await save("owner@example.test", { "Content-Type": "application/json" })).status, 403);
      assert.equal((await save("owner@example.test", { ...owner, origin: "https://evil.example.test" })).status, 403);
      assert.equal((await save(address)).status, 400);
      assert.deepEqual(await (await save("owner@example.test")).json(), { enabled: true, recipient: "owner@example.test", canManage: true });
      assert.deepEqual((await (await fetch(url)).json() as any).forwarding, { enabled: true, recipient: null, canManage: false });
      assert.equal((await forward({ ...owner, "x-fixture-dealer": "b" })).status, 409);
      assert.equal((await forward()).status, 200);
      assert.deepEqual(await (await forward()).json(), { queued: true, alreadyQueued: true });
      const after = await receipt(review);
      assert.equal(after.status, "review");
      assert.equal(after.enquiry_id, null);
      assert.equal(after.draft_status, before.draft_status);
      assert.equal(String(after.received_at), String(before.received_at));
      const status = (await (await fetch(url, { headers: owner })).json() as any).receipts.find((r: any) => r.id === before.id);
      assert.equal(status.forwardStatus, "pending");
      assert.equal(status.canForward, false);

      const direct = await queue();
      const reviewAgain = await queue();
      const partExchange = email(direct, {
        subject: "Part-Ex - Lexus RX AB15CDE - Sam",
        text: text("2".repeat(32))
          .replace("Customer message", "Part-exchange vehicle details\n\nPX12 ABC\n\n140000 miles 0001-01-01\n\nCustomer message")
          .replace("Do you accept px for a Lexus GS450h 2008?", "I have a part exchange\nVRM: PX12 ABC\nMileage: 140000")
          .replace("Enquiry type\nQuestion", "Enquiry type\nPart-ex  Urgent          Availability"),
      });
      const withoutMessage = parseCazooLead({ ...partExchange, text: partExchange.text.replace("I have a part exchange\nVRM: PX12 ABC\nMileage: 140000", "") });
      assert.match(withoutMessage.message, /Cazoo part exchange enquiry/);
      assert.throws(() => parseCazooLead({ ...partExchange, text: partExchange.text.replace("I have a part exchange", "Customer details\nsomeone@example.test") }), { code: "unrecognised_message_layout" });
      await processCazooLeads(transportFor({
        [direct]: partExchange,
        [reviewAgain]: email(reviewAgain, { text: text("3".repeat(32)).replace("sam@example.test", "sam@example.test ( another@example.test )") }),
      }), draftSkip);
      const importedPartExchange = await receipt(direct);
      assert.equal(importedPartExchange.status, "imported");
      const entry = (await engine.query(
        "SELECT type,vehicle_id,vehicle_registration,part_exchange_registration,part_exchange_mileage,email,customer_notification_status FROM enquiries WHERE id=$1",
        [importedPartExchange.enquiry_id],
      )).rows[0];
      assert.deepEqual(entry, {
        type: "part_exchange", vehicle_id: carId, vehicle_registration: "AB15CDE",
        part_exchange_registration: "PX12 ABC", part_exchange_mileage: 140000,
        email: "sam@example.test", customer_notification_status: "not_sent",
      });
      const copied = (await engine.query<{ status: string; recipient: string }>(
        "SELECT status,recipient FROM cazoo_lead_forwards WHERE dealer_id='cazoo-a' ORDER BY receipt_id",
      )).rows;
      assert.equal(copied.length, 3);
      assert.ok(copied.every(r => r.status === "pending" && r.recipient === "owner@example.test"));
    } finally {
      await engine.exec("DELETE FROM cazoo_lead_forwarding_settings WHERE dealer_id='cazoo-a'");
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
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
