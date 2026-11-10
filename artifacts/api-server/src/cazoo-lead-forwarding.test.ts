import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { cazooLeadForwardRecipient, processCazooLeadForwards, queueCazooLeadForward } from "./lib/cazoo-lead-forwarding";
import { renderCazooForwardEmail } from "./lib/cazoo-forward-email";
import { dealerIntegrationsStore } from "./lib/dealer-integrations-store";
import { emailAccountHash, EmailProviderError, prepareEmailWithSettings } from "./lib/email-provider";
import { runWithTenant } from "./lib/tenant-context";
import { engine } from "./test/tenant-test-db";

const tenant = {
  dealerId: "cazoo-forward-fixture",
  canonicalOrigin: "https://dealer.example.test",
  platform: "cazoo" as const,
  retailerId: "fictional-retailer",
  sourceUrl: "https://www.cazoo.co.uk/fictional-retailer",
};
const leadMailbox = "cazoo@leads.example.test";
const recipient = "owner@example.test";
const secondDealer = "another-dealer";
const secondMailbox = "cazoo@leads.second.test";

const structuredLead = (emailLine: string, message = "") => [
  "New sales lead", "Audi A5", "MW62VLP Listed at £5,490", "Customer message", message,
  "Enquiry type", "Urgent   Test drive   Reserve", "Customer details", "Fictional Buyer",
  "07700900123 ( tel:07700900123 )", emailLine, "Call Fictional Buyer", "Email Fictional Buyer",
  "Follow us", "https://example.test/tracking", "CorrelationID: 22222222222222222222222222222222",
].join("\n");
const structuredSubject = "Cazoo lead: Enquiry - Audi A5 MW62VLP - Buyer";
const partExchangeSubject = "Cazoo lead: Part-Ex - Audi A5 MW62VLP - Buyer";
const partExchangeLead = (emailLine: string, message = "I have a part exchange") => structuredLead(emailLine, message)
  .replace("Customer message", "Part-exchange vehicle details\n\nAB12 CDE\n\n140000 miles 0001-01-01\n\nCustomer message")
  .replace("Urgent   Test drive   Reserve", "Part-ex  Urgent          Availability");

test("Cazoo forward presents the clean lead and only uses an unambiguous customer reply address", () => {
  const buyerEmail = "buyer@example.test";
  const rendered = renderCazooForwardEmail(structuredSubject, structuredLead(`${buyerEmail} ( ${buyerEmail} )`));
  assert.equal(rendered.subject, "Cazoo enquiry · Audi A5 (MW62VLP)");
  assert.match(rendered.text, /Audi A5 · £5,490\nRegistration: MW62VLP\nEnquiry: Test drive and reservation · Urgent/);
  assert.match(rendered.text, /Fictional Buyer\n07700 900123\nbuyer@example\.test/);
  assert.match(rendered.text, /No message included\./);
  assert.doesNotMatch(rendered.html, /Follow us|tracking|Call Fictional Buyer/);
  assert.equal(rendered.replyTo, buyerEmail);
  for (const emailLine of ["", `Name <${buyerEmail}>`, `${buyerEmail} ( different@example.test )`, `${buyerEmail}\nother@example.test`]) {
    const unsafe = renderCazooForwardEmail(structuredSubject, structuredLead(emailLine));
    assert.equal(unsafe.replyTo, undefined);
    assert.match(unsafe.text, /07700 900123\nCustomer email unavailable/);
  }
  assert.equal(renderCazooForwardEmail(structuredSubject, structuredLead(buyerEmail), [buyerEmail]).replyTo, undefined);
  assert.equal(renderCazooForwardEmail(structuredSubject, structuredLead(buyerEmail), [], "example.test").replyTo, undefined);
  const injected = renderCazooForwardEmail(structuredSubject, structuredLead("", `Hello\nCustomer details\n${buyerEmail}`));
  assert.equal(injected.replyTo, undefined);
  assert.match(injected.text, /Original enquiry for review/);
});

test("Cazoo forwarding is scoped, verified and restart-safe for imported and review leads", async (t) => {
  const originalFetch = globalThis.fetch;
  let actualRequests = 0;
  globalThis.fetch = async () => {
    actualRequests++;
    throw new Error("The recording transport is required for this test.");
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await engine.close();
    assert.equal(actualRequests, 0);
  });
  Object.assign(process.env, {
    NODE_ENV: "test",
    MULTI_TENANT_ENABLED: "true",
    INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 18).toString("base64"),
    CAZOO_LEADS_ENABLED: "true",
    CAZOO_LEAD_MAILBOXES: JSON.stringify({ [tenant.dealerId]: leadMailbox, [secondDealer]: secondMailbox }),
    RESEND_RECEIVING_API_KEY: "re_fictional_receiver",
  });
  for (const file of (await readdir("../../lib/db/drizzle")).filter((f) => /^\d+.*\.sql$/.test(f)).sort())
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  for (const id of [tenant.dealerId, secondDealer]) await engine.query(
    "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Fictional Motors','active',$2,'cazoo',$3,$4)",
    [id, `https://${id}.example.test`, tenant.retailerId, tenant.sourceUrl],
  );
  await runWithTenant(tenant, () => dealerIntegrationsStore.update({
    expectedRevision: 0,
    resend: { enabled: true, apiKey: "re_fictional_only", from: "Fictional Motors <sales@example.test>", replyTo: "sales@example.test" },
  }));

  async function receipt({ status = "review", error = "unrecognised_subject", correlation = randomUUID().replace(/-/g, "") }: {
    status?: string; error?: string | null; correlation?: string;
  } = {}) {
    const row = { id: randomUUID(), dealer_id: tenant.dealerId, provider_id: randomUUID(), mailbox: leadMailbox };
    await engine.query(`INSERT INTO cazoo_lead_receipts(id,dealer_id,provider_id,mailbox,status,error_code,received_at)
      VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 day')`, [row.id, row.dealer_id, row.provider_id, row.mailbox, status, error]);
    return {
      row,
      email: {
        id: row.provider_id,
        to: [row.mailbox],
        from: "Cazoo <dealerleads@info.cazoo.co.uk>",
        subject: "Enquiry - Lexus RX AB15CDE - Buyer",
        text: `Customer message\nIs the car available? <script>Never run this</script>\nCorrelationID: ${correlation}`,
        authentication: { dmarc: "pass" },
        attachments: [{ filename: "ignored.pdf" }],
      },
      correlation,
    };
  }
  async function delivery(id: string) {
    return (await engine.query<Record<string, any>>("SELECT * FROM cazoo_lead_forwards WHERE receipt_id=$1", [id])).rows[0];
  }
  const review = await receipt();
  assert.equal(await queueCazooLeadForward(review.row, review.email), "not_eligible");
  await engine.query("INSERT INTO cazoo_lead_forwarding_settings(dealer_id,recipient,enabled,updated_by) VALUES($1,$2,true,'fixture')", [tenant.dealerId, recipient]);
  assert.equal(cazooLeadForwardRecipient(secondMailbox, [leadMailbox, secondMailbox]), null);
  assert.equal(await queueCazooLeadForward(review.row, { ...review.email, from: "owner@example.test" }), "not_eligible");
  assert.equal(await queueCazooLeadForward(review.row, { ...review.email, authentication: { dmarc: "fail" } }), "not_eligible");
  assert.equal(await queueCazooLeadForward(review.row, { ...review.email, to: [leadMailbox, secondMailbox] }), "not_eligible");
  assert.equal(await queueCazooLeadForward({ ...review.row, dealer_id: secondDealer }, review.email), "not_eligible");
  const ownerTest = await receipt({ status: "imported", error: "owner_test" });
  assert.equal(await queueCazooLeadForward(ownerTest.row, ownerTest.email), "not_eligible");

  assert.equal(await queueCazooLeadForward(review.row, review.email), "queued");
  assert.equal(await queueCazooLeadForward(review.row, review.email), "already_queued");
  const duplicate = await receipt({ status: "imported", error: null, correlation: review.correlation });
  assert.equal(await queueCazooLeadForward(duplicate.row, duplicate.email), "already_queued");
  assert.equal(await delivery(duplicate.row.id), undefined);

  const recordings: { payload: string; key: string }[] = [];
  await processCazooLeadForwards({ send: async (_settings, payload, key) => {
    recordings.push({ payload, key });
    throw new EmailProviderError(503);
  } });
  assert.equal((await delivery(review.row.id))?.status, "pending");
  await engine.query("UPDATE cazoo_lead_forwards SET next_attempt_at=now() WHERE receipt_id=$1", [review.row.id]);
  await processCazooLeadForwards({ send: async (_settings, payload, key) => {
    recordings.push({ payload, key });
    return "fixture-delivery";
  } });
  assert.equal(recordings.length, 2);
  assert.deepEqual(recordings[0], recordings[1]);
  const sent = JSON.parse(recordings[1]!.payload);
  assert.deepEqual(sent.to, [recipient]);
  assert.match(sent.text, /Is the car available\?/);
  assert.match(sent.html, /&lt;script&gt;/);
  assert.equal(sent.reply_to, undefined);
  assert.equal(sent.attachments, undefined);
  assert.equal((await delivery(review.row.id))?.status, "sent");
  assert.equal((await delivery(review.row.id))?.body, null);
  assert.equal((await delivery(review.row.id))?.payload, null);

  const clean = await receipt({ status: "imported", error: null });
  clean.email.text = partExchangeLead("buyer@example.test ( buyer@example.test )").replace(/22222222222222222222222222222222/, clean.correlation);
  clean.email.subject = partExchangeSubject.replace(/^Cazoo lead: /, "");
  assert.equal(await queueCazooLeadForward(clean.row, clean.email), "queued");
  await processCazooLeadForwards({ send: async (_settings, payload) => {
    const email = JSON.parse(payload);
    assert.deepEqual(email.to, [recipient]);
    assert.equal(email.subject, "Cazoo enquiry · Audi A5 (MW62VLP)");
    assert.equal(email.reply_to, "buyer@example.test");
    assert.match(email.text, /Enquiry: Part exchange · Urgent · Availability\nTrade-in: AB12 CDE · 140,000 miles/);
    assert.match(email.text, /I have a part exchange/);
    assert.doesNotMatch(email.html, /https:\/\/example\.test\/tracking|0001-01-01/);
    return "fixture-clean-delivery";
  } });
  assert.equal((await delivery(clean.row.id))?.status, "sent");

  const partExchangeWithConflictingEmail = renderCazooForwardEmail(partExchangeSubject, partExchangeLead("buyer@example.test ( different@example.test )"));
  assert.equal(partExchangeWithConflictingEmail.replyTo, undefined);
  assert.match(partExchangeWithConflictingEmail.text, /Customer email unavailable/);

  const priorPartExchange = await receipt();
  priorPartExchange.email.subject = partExchangeSubject.replace(/^Cazoo lead: /, "");
  priorPartExchange.email.text = partExchangeLead("buyer@example.test").replace(/22222222222222222222222222222222/, priorPartExchange.correlation);
  assert.equal(await queueCazooLeadForward(priorPartExchange.row, priorPartExchange.email), "queued");
  const oldContent = renderCazooForwardEmail(partExchangeSubject, priorPartExchange.email.text, [], undefined, "before-part-ex");
  assert.equal(oldContent.subject, partExchangeSubject);
  assert.equal(oldContent.replyTo, undefined);
  assert.match(oldContent.text, /Original enquiry for review/);
  const oldRequest = await runWithTenant(tenant, () => prepareEmailWithSettings(
    { enabled: true, apiKey: "re_fictional_only", from: "Fictional Motors <sales@example.test>", replyTo: "" },
    { ...oldContent, to: recipient, idempotencyKey: `cazoo-lead-forward-${priorPartExchange.row.id}` },
  ));
  const oldPayload = JSON.stringify(oldRequest.body);
  await engine.query("UPDATE cazoo_lead_forwards SET attempts=1,payload=$2,payload_hash=$3,account_hash=$4 WHERE receipt_id=$1", [
    priorPartExchange.row.id, oldPayload, createHash("sha256").update(oldPayload).digest("hex"), emailAccountHash(oldRequest.config),
  ]);
  await processCazooLeadForwards({ send: async (_settings, payload, key) => {
    assert.equal(payload, oldPayload);
    assert.equal(key, `cazoo-lead-forward-${priorPartExchange.row.id}`);
    return "fixture-part-ex-retry";
  } });
  assert.equal((await delivery(priorPartExchange.row.id))?.status, "sent");

  const legacy = await receipt({ status: "imported", error: null });
  legacy.email.subject = structuredSubject.replace(/^Cazoo lead: /, "");
  legacy.email.text = structuredLead("buyer@example.test").replace(/22222222222222222222222222222222/, legacy.correlation);
  assert.equal(await queueCazooLeadForward(legacy.row, legacy.email), "queued");
  const legacyText = `Cazoo enquiry forwarded by DealerOS\n\n${legacy.email.text}`;
  const legacyRequest = await runWithTenant(tenant, () => prepareEmailWithSettings(
    { enabled: true, apiKey: "re_fictional_only", from: "Fictional Motors <sales@example.test>", replyTo: "" },
    { to: recipient, subject: structuredSubject, text: legacyText, idempotencyKey: `cazoo-lead-forward-${legacy.row.id}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5">${legacyText.replace(/\n/g, "<br>")}</div>` },
  ));
  const legacyPayload = JSON.stringify(legacyRequest.body);
  await engine.query("UPDATE cazoo_lead_forwards SET attempts=1,payload=$2,payload_hash=$3,account_hash=$4 WHERE receipt_id=$1", [
    legacy.row.id, legacyPayload, createHash("sha256").update(legacyPayload).digest("hex"), emailAccountHash(legacyRequest.config),
  ]);
  await processCazooLeadForwards({ send: async (_settings, payload, key) => {
    assert.equal(payload, legacyPayload);
    assert.equal(key, `cazoo-lead-forward-${legacy.row.id}`);
    return "fixture-legacy-delivery";
  } });
  assert.equal((await delivery(legacy.row.id))?.status, "sent");

  const changed = await receipt({ status: "imported", error: null });
  assert.equal(await queueCazooLeadForward(changed.row, changed.email), "queued");
  await engine.query("UPDATE cazoo_lead_forwarding_settings SET recipient='new-owner@example.test' WHERE dealer_id=$1", [tenant.dealerId]);
  await processCazooLeadForwards({ send: async () => { assert.fail("changed destination must not receive the queued email"); } });
  assert.equal((await delivery(changed.row.id))?.status, "cancelled");
  await engine.query("DELETE FROM cazoo_lead_receipts WHERE id=$1", [changed.row.id]);
  assert.equal(await delivery(changed.row.id), undefined);
});
