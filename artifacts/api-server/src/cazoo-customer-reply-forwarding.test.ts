import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { processCazooCustomerReplyForwards } from "./lib/cazoo-customer-reply-forwarding";
import { dealerIntegrationsStore } from "./lib/dealer-integrations-store";
import { purgeTerminalEmailPayloads } from "./lib/email-outbox";
import { EmailProviderError } from "./lib/email-provider";
import { runWithTenant } from "./lib/tenant-context";
import { engine } from "./test/tenant-test-db";

const tenant = {
  dealerId: "forwarded-reply-fixture", canonicalOrigin: "https://dealer.example.test", platform: "cazoo" as const,
  retailerId: "fictional-retailer", sourceUrl: "https://www.cazoo.co.uk/fictional-retailer",
};
const owner = "owner@example.test";
const customer = "buyer@example.test";
const leadMailbox = "cazoo@leads.example.test";
const replyAddress = "r-fictional@replies.example.test";
const message = "Is it available on Saturday? <img src=x> & thanks.";

test("verified Cazoo reply notices are scoped and retry without changing the approved delivery", async (t) => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error("The recording transport is required for this test.");
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await engine.close();
    assert.equal(networkCalls, 0);
  });
  Object.assign(process.env, {
    NODE_ENV: "test", MULTI_TENANT_ENABLED: "true", INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 18).toString("base64"),
    CAZOO_LEADS_ENABLED: "true", CAZOO_LEAD_MAILBOXES: JSON.stringify({ [tenant.dealerId]: leadMailbox }),
    EMAIL_REPLIES_ENABLED: "true", EMAIL_REPLY_DOMAINS: JSON.stringify({ [tenant.dealerId]: "replies.example.test" }),
    RESEND_RECEIVING_API_KEY: "re_fictional_receiver", RESEND_RECEIVING_WEBHOOK_SECRET: "whsec_fictional",
  });
  for (const file of (await readdir("../../lib/db/drizzle")).filter((f) => /^\d+.*\.sql$/.test(f)).sort())
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  await engine.query(`INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url)
    VALUES($1,'Fictional Motors','active',$2,'cazoo',$3,$4)`, [tenant.dealerId, tenant.canonicalOrigin, tenant.retailerId, tenant.sourceUrl]);
  await runWithTenant(tenant, () => dealerIntegrationsStore.update({
    expectedRevision: 0,
    resend: { enabled: true, apiKey: "re_fictional_only", from: "Fictional Motors <sales@example.test>", replyTo: owner },
  }));
  await engine.query(`INSERT INTO cazoo_lead_forwarding_settings(dealer_id,recipient,enabled,forward_replies,updated_by)
    VALUES($1,$2,true,true,'fixture')`, [tenant.dealerId, owner]);

  const leadId = randomUUID(), mergedId = randomUUID(), receiptId = randomUUID(), routeId = randomUUID();
  await engine.query(`INSERT INTO enquiries(id,dealer_id,type,customer_name,email,message,source,vehicle_title,vehicle_registration)
    VALUES($1,$3,'general','Fictional Buyer',$4,'Original Cazoo enquiry','cazoo','Audi A5','MW62VLP'),
      ($2,$3,'general','Fictional Buyer',$4,'Other enquiry','website','Audi A5','MW62VLP')`, [leadId, mergedId, tenant.dealerId, customer]);
  await engine.query(`INSERT INTO cazoo_lead_receipts(id,provider_id,dealer_id,mailbox,status,enquiry_id)
    VALUES($1,$2,$3,$4,'imported',$5)`, [receiptId, randomUUID(), tenant.dealerId, leadMailbox, leadId]);
  await engine.query(`INSERT INTO enquiry_email_reply_routes(id,dealer_id,enquiry_id,send_key,reply_address,recipient)
    VALUES($1,$2,$3,'fixture-first-reply',$4,$5)`, [routeId, tenant.dealerId, leadId, replyAddress, customer]);

  async function queue({ status = "received", replyRoute = routeId, caseId = leadId } = {}) {
    const id = randomUUID();
    await engine.query(`INSERT INTO enquiry_email_replies(id,provider_id,route_id,dealer_id,enquiry_id,status,sender,subject,message,attachment_names)
      VALUES($1,$2,$3,$4,$5,$6,$7,'Re: Audi A5',$8,'["customer.pdf"]'::jsonb)`,
    [id, randomUUID(), replyRoute, tenant.dealerId, caseId, status, customer, message]);
    await engine.query(`INSERT INTO cazoo_customer_reply_forwards(reply_id,dealer_id,lead_receipt_id,recipient,retry_deadline)
      VALUES($1,$2,$3,$4,now()+interval '1 hour')`, [id, tenant.dealerId, receiptId, owner]);
    return id;
  }
  async function delivery(id: string) {
    return (await engine.query<Record<string, unknown>>("SELECT * FROM cazoo_customer_reply_forwards WHERE reply_id=$1", [id])).rows[0];
  }

  const replyId = await queue();
  await engine.query("UPDATE enquiries SET merged_into_id=$2 WHERE id=$1", [leadId, mergedId]);
  const recordings: { payload: string; key: string }[] = [];
  await processCazooCustomerReplyForwards({ send: async (_config, payload, key) => {
    recordings.push({ payload, key });
    throw new EmailProviderError(503);
  } });
  assert.equal((await delivery(replyId))?.status, "pending");
  assert.equal((await delivery(replyId))?.attempts, 1);
  assert.equal((await delivery(replyId))?.payload, recordings[0]?.payload);
  await engine.query("UPDATE cazoo_customer_reply_forwards SET next_attempt_at=now() WHERE reply_id=$1", [replyId]);
  await processCazooCustomerReplyForwards({ send: async (_config, payload, key) => {
    recordings.push({ payload, key });
    return "fixture-notice";
  } });
  assert.equal(recordings.length, 2);
  assert.deepEqual(recordings[0], recordings[1]);
  assert.equal(recordings[0]?.key, `cazoo-customer-reply-forward-${replyId}`);
  const sent = JSON.parse(recordings[1]!.payload);
  const link = `${tenant.canonicalOrigin}/portal?section=notifications&workView=customers&enquiryId=${mergedId}&enquiryAction=reply&enquiryReplyId=${replyId}`;
  assert.deepEqual(sent.to, [owner]);
  assert.ok(sent.text.includes(link));
  assert.ok(sent.html.includes(`href="${link.replace(/&/g, "&amp;")}"`));
  assert.match(sent.html, /&lt;img src=x&gt; &amp; thanks\./);
  assert.doesNotMatch(sent.html, /<img|customer\.pdf/);
  assert.equal(sent.reply_to, undefined);
  assert.equal(sent.headers, undefined);
  assert.equal(sent.attachments, undefined);
  assert.equal((await delivery(replyId))?.status, "sent");
  assert.equal((await delivery(replyId))?.provider_id, "fixture-notice");
  assert.equal((await delivery(replyId))?.payload, null);
  assert.equal((await engine.query<{ status: string }>("SELECT status FROM enquiry_email_replies WHERE id=$1", [replyId])).rows[0]?.status, "received");

  const prohibited = { send: async () => assert.fail("An ineligible reply notice must not reach the transport") };
  const targetedRoute = randomUUID(), websiteRoute = randomUUID(), targetedDelivery = randomUUID();
  const targetedKey = `enquiry-${targetedDelivery}`;
  await engine.query(`INSERT INTO enquiry_email_reply_routes(id,dealer_id,enquiry_id,send_key,reply_address,recipient)
    VALUES($1,$3,$4,$5,'r-targeted@replies.example.test',$6),
      ($2,$3,$4,'ordinary-website-reply','r-website@replies.example.test',$6)`,
  [targetedRoute, websiteRoute, tenant.dealerId, mergedId, targetedKey, customer]);
  await engine.query(`INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,created_by)
    VALUES($1,$2,$3,$4,'fixture','sent',$5,'Re: Audi A5','Private outgoing message','fixture')`,
  [targetedDelivery, tenant.dealerId, mergedId, randomUUID(), customer]);
  await engine.query(`INSERT INTO email_outbox(dealer_id,enquiry_id,delivery_id,kind,send_key,payload,payload_hash,validation_hash,validation,account_hash,status,attempts,retry_deadline,created_at)
    VALUES($1,$2,$3,'staff',$4,'private outgoing message','fixture','fixture',$5::jsonb,'fixture','sent',1,now()-interval '2 days',now()-interval '3 days')`,
  [tenant.dealerId, mergedId, targetedDelivery, targetedKey, JSON.stringify({ enquiryReplyId: replyId, input: { message: "private outgoing message" } })]);
  await purgeTerminalEmailPayloads(new Date(), tenant.dealerId);
  const retained = (await engine.query("SELECT payload,validation FROM email_outbox WHERE dealer_id=$1 AND send_key=$2", [tenant.dealerId, targetedKey])).rows[0];
  assert.deepEqual(retained, { payload: null, validation: { payloadRetained: false, enquiryReplyId: replyId } });

  const followUp = await queue({ replyRoute: targetedRoute, caseId: mergedId });
  const messages: string[] = [];
  await processCazooCustomerReplyForwards({ send: async (_config, payload) => {
    messages.push(JSON.parse(payload).text);
    return "fixture-follow-up-notice";
  } });
  assert.equal((await delivery(followUp))?.status, "sent");
  assert.equal(messages.length, 1);
  assert.ok(messages[0]?.includes(link.replace(replyId, followUp)));

  const unrelated = await queue({ replyRoute: websiteRoute, caseId: mergedId });
  await processCazooCustomerReplyForwards(prohibited);
  assert.equal((await delivery(unrelated))?.status, "cancelled");

  const changed = await queue();
  await engine.query("UPDATE cazoo_lead_forwarding_settings SET recipient='new-owner@example.test' WHERE dealer_id=$1", [tenant.dealerId]);
  await processCazooCustomerReplyForwards(prohibited);
  assert.equal((await delivery(changed))?.status, "cancelled");
  const disabled = await queue();
  await engine.query("UPDATE cazoo_lead_forwarding_settings SET recipient=$2,forward_replies=false WHERE dealer_id=$1", [tenant.dealerId, owner]);
  await processCazooCustomerReplyForwards(prohibited);
  assert.equal((await delivery(disabled))?.status, "cancelled");
  await engine.query("UPDATE cazoo_lead_forwarding_settings SET forward_replies=true WHERE dealer_id=$1", [tenant.dealerId]);
  const review = await queue({ status: "review" });
  await processCazooCustomerReplyForwards(prohibited);
  assert.equal((await delivery(review))?.status, "cancelled");

  const expired = await queue();
  await engine.query("UPDATE cazoo_customer_reply_forwards SET retry_deadline=now()-interval '1 minute' WHERE reply_id=$1", [expired]);
  await processCazooCustomerReplyForwards(prohibited);
  assert.equal((await delivery(expired))?.status, "failed");
});
