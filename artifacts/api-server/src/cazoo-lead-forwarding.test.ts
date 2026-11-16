import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { cazooLeadForwardRecipient, processCazooLeadForwards, queueCazooLeadForward } from "./lib/cazoo-lead-forwarding";
import { renderCazooCustomerReplyForwardEmail, renderCazooForwardEmail } from "./lib/cazoo-forward-email";
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
const whatsappLink = (text: string) => new URL(/(?:^|\n)Reply on WhatsApp\n([^\n]+)/.exec(text)![1]!);

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

test("Cazoo dealer notices use WhatsApp or phone for restricted Apple relay addresses", () => {
  const origin = "https://dealer.example.test";
  const enquiryId = randomUUID();
  for (const domain of ["privaterelay.appleid.com", "private.icloud.com"]) {
    const email = `buyer@${domain}`;
    const lead = structuredLead(email);
    const forward = renderCazooForwardEmail(structuredSubject, lead, [], undefined, "current", { origin, enquiryId });
    assert.equal(forward.replyTo, undefined);
    assert.doesNotMatch(forward.text, /buyer@|Reply in DealerOS/);
    assert.match(forward.text, /DealerOS can’t email this private Apple address/);
    assert.ok(forward.text.indexOf("Reply on WhatsApp") < forward.text.indexOf("Call customer"));
    assert.match(forward.html, /href="tel:\+447700900123"/);
    assert.match(forward.html, /enquiryAction=fix-email/);
    const noPhone = renderCazooForwardEmail(structuredSubject, lead.replace("tel:07700900123", "tel:07700900124"), [], undefined, "current", { origin, enquiryId });
    assert.match(noPhone.text, /No usable phone number was supplied/);
    assert.doesNotMatch(noPhone.html, /wa\.me|href="tel:|Reply in DealerOS/);
    assert.equal(renderCazooForwardEmail(structuredSubject, lead, [], undefined, "current", { origin, enquiryId }, undefined,
      { allowLegacyAppleReply: true }).replyTo, email);

    const followUp = renderCazooCustomerReplyForwardEmail({
      origin, enquiryId, replyId: randomUUID(), customerName: "Fictional Buyer", customerAddress: email,
      customerPhone: "07700 900123", vehicleTitle: "Audi A5", vehicleRegistration: "MW62VLP",
      subject: "Re: Audi A5", message: "Saturday works for me.",
    })!;
    assert.match(followUp.text, /Saturday works for me/);
    assert.match(followUp.text, /DealerOS can’t email this private Apple address/);
    assert.match(followUp.html, /href="tel:\+447700900123"/);
    assert.match(followUp.html, /enquiryAction=fix-email/);
    assert.doesNotMatch(followUp.html, /enquiryReplyId=|Reply in DealerOS/);
  }
  assert.equal(renderCazooForwardEmail(structuredSubject, structuredLead("hide-my-email@icloud.com")).replyTo, "hide-my-email@icloud.com");
});

test("WhatsApp opens a direct editable draft for a usable Cazoo phone", () => {
  const phoneOnly = structuredLead("Email: not supplied");
  const origin = "https://dealer.example.test";
  const enquiryId = randomUUID();
  const linked = renderCazooForwardEmail(structuredSubject, phoneOnly, [], undefined, "current", { origin, enquiryId }, undefined, { whatsapp: "direct" });
  assert.equal(linked.replyTo, undefined);
  const linkedWhatsApp = whatsappLink(linked.text);
  assert.equal(linkedWhatsApp.origin, "https://wa.me");
  assert.equal(linkedWhatsApp.pathname, "/447700900123");
  assert.equal(linkedWhatsApp.searchParams.get("text"), "Audi A5\nMW62 VLP\n\nHi Fictional,\n\n");
  assert.ok(linked.text.indexOf("Reply on WhatsApp\n") < linked.text.indexOf("Add customer email"));
  assert.doesNotMatch(linked.html, /enquiryAction=(?:reply|whatsapp)/);
  const unlinked = renderCazooForwardEmail(structuredSubject, phoneOnly, [], undefined, "current", { origin, enquiryId: null }, undefined, { whatsapp: "direct" });
  assert.equal(whatsappLink(unlinked.text).href, linkedWhatsApp.href);
  const invalidPhone = phoneOnly.replace("tel:07700900123", "tel:07700900124");
  const noPhone = renderCazooForwardEmail(structuredSubject, invalidPhone, [], undefined, "current", { origin, enquiryId }, undefined, { whatsapp: "direct" });
  assert.doesNotMatch(noPhone.html, /WhatsApp|wa\.me|enquiryAction=whatsapp/);
  assert.match(noPhone.text, /Add customer email/);
  const unchanged = renderCazooForwardEmail(structuredSubject, phoneOnly, [], undefined, "current", { origin, enquiryId });
  assert.doesNotMatch(unchanged.html, /WhatsApp|enquiryAction=whatsapp/);
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

  async function receipt({ status = "review", error = "unrecognised_subject", correlation = randomUUID().replace(/-/g, ""), customerEmail = null }: {
    status?: string; error?: string | null; correlation?: string; customerEmail?: string | null;
  } = {}) {
    const row = { id: randomUUID(), dealer_id: tenant.dealerId, provider_id: randomUUID(), mailbox: leadMailbox };
    const enquiryId = status === "imported" ? randomUUID() : null;
    if (enquiryId) await engine.query(`INSERT INTO enquiries(id,dealer_id,type,customer_name,email,message,source)
      VALUES($1,$2,'general','Fictional Buyer',$3,'I am interested','cazoo')`, [enquiryId, row.dealer_id, customerEmail]);
    await engine.query(`INSERT INTO cazoo_lead_receipts(id,dealer_id,provider_id,mailbox,status,error_code,enquiry_id,received_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()-interval '1 day')`, [row.id, row.dealer_id, row.provider_id, row.mailbox, status, error, enquiryId]);
    return {
      row,
      enquiryId,
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
  const tenantOrigin = `https://${tenant.dealerId}.example.test`;
  assert.ok(sent.text.includes(`${tenantOrigin}/portal?section=settings&settingsTab=emails`));
  assert.doesNotMatch(sent.text, /enquiryId|enquiryAction/);
  assert.equal(sent.reply_to, undefined);
  assert.equal(sent.attachments, undefined);
  assert.equal((await delivery(review.row.id))?.status, "sent");
  assert.equal((await delivery(review.row.id))?.body, null);
  assert.equal((await delivery(review.row.id))?.payload, null);

  const clean = await receipt({ status: "imported", error: null, customerEmail: "buyer@example.test" });
  clean.email.text = partExchangeLead("buyer@example.test ( buyer@example.test )").replace(/22222222222222222222222222222222/, clean.correlation);
  clean.email.subject = partExchangeSubject.replace(/^Cazoo lead: /, "");
  clean.email.text = clean.email.text.replace("Part-ex  Urgent          Availability", "Part-ex Availability");
  const picturedVehicle = randomUUID();
  const photo = "https://cdn.images.autoexposure.co.uk/fictional/audi.jpg?size=600&quality=80";
  await engine.query(`INSERT INTO vehicles(id,dealer_id,source,advert_id,make,model,trim,year,source_price,mileage,fuel,transmission)
    VALUES($1,$2,'cazoo','fixture-audi','Audi','A5','S line',2013,5990,76000,'Diesel','Automatic')`,
  [picturedVehicle, tenant.dealerId]);
  await engine.query("INSERT INTO vehicle_images(vehicle_id,source_url,is_hero) VALUES($1,$2,true)", [picturedVehicle, photo]);
  const publicLink = (await engine.query<{ code: string }>("SELECT code FROM vehicle_public_links WHERE vehicle_id=$1", [picturedVehicle])).rows[0]!;
  await engine.query("UPDATE enquiries SET vehicle_id=$2 WHERE id=$1", [clean.enquiryId, picturedVehicle]);
  assert.equal(await queueCazooLeadForward(clean.row, clean.email), "queued");
  let picturedPayload: string | undefined;
  await processCazooLeadForwards({ send: async (_settings, payload) => {
    picturedPayload = payload;
    const email = JSON.parse(payload);
    assert.deepEqual(email.to, [recipient]);
    assert.equal(email.subject, "Cazoo enquiry · Audi A5 (MW62VLP)");
    assert.equal(email.reply_to, "buyer@example.test");
    assert.match(email.text, /Enquiry: Part exchange · Availability\nTrade-in: AB12 CDE · 140,000 miles/);
    assert.match(email.text, /I have a part exchange/);
    assert.match(email.text, /Listed on Cazoo: £5,490\nTrim: S line\nYear: 2013\nMileage: 76,000 miles\nFuel: Diesel\nGearbox: Automatic/);
    assert.ok(email.html.includes(`<img src="${photo.replace(/&/g, "&amp;")}" alt="Audi A5"`));
    assert.doesNotMatch(email.text, /£5,990|autoexposure/);
    assert.doesNotMatch(email.html, /https:\/\/example\.test\/tracking|0001-01-01/);
    const route = `${tenantOrigin}/portal?section=notifications&workView=customers&enquiryId=${clean.enquiryId}`;
    assert.ok(email.text.includes(`Reply in DealerOS\n${route}&enquiryAction=reply`));
    assert.ok(email.text.includes(`Fix email address\n${route}&enquiryAction=fix-email`));
    const whatsapp = whatsappLink(email.text);
    assert.equal(whatsapp.href.split("?")[0], "https://wa.me/447700900123");
    assert.equal(whatsapp.searchParams.get("text"), `2013 Audi A5 S line\nMW62 VLP · 76,000 miles · £5,990\n${tenantOrigin}/s/${publicLink.code}\n\nHi Fictional,\n\n`);
    assert.ok(email.html.includes(`href="${whatsapp.href}"`));
    assert.match(email.html, /https:\/\/wa\.me\/[^\"]+" style="[^"]*border:1px solid #172740[^"]*">Reply on WhatsApp/);
    assert.match(email.html, /enquiryAction=fix-email" style="[^"]*text-decoration:underline">Fix email address/);
    for (const action of ["reply", "fix-email"]) {
      assert.ok(email.html.includes(`href="${`${route}&enquiryAction=${action}`.replace(/&/g, "&amp;")}"`));
    }
    throw new EmailProviderError(503);
  } });
  assert.ok(picturedPayload);
  assert.equal((await delivery(clean.row.id))?.status, "pending");
  await engine.query("UPDATE vehicles SET mileage=90000 WHERE id=$1", [picturedVehicle]);
  await engine.query("UPDATE vehicle_images SET is_active=false WHERE vehicle_id=$1", [picturedVehicle]);
  await engine.query("UPDATE cazoo_lead_forwards SET next_attempt_at=now() WHERE receipt_id=$1", [clean.row.id]);
  await processCazooLeadForwards({ send: async (_settings, payload, key) => {
    assert.equal(payload, picturedPayload);
    assert.equal(key, `cazoo-lead-forward-${clean.row.id}`);
    return "fixture-clean-delivery";
  } });
  assert.equal((await delivery(clean.row.id))?.status, "sent");

  const beforeWhatsApp = await receipt({ status: "imported", error: null });
  beforeWhatsApp.email.subject = structuredSubject.replace(/^Cazoo lead: /, "");
  beforeWhatsApp.email.text = structuredLead("buyer@example.test").replace(/22222222222222222222222222222222/, beforeWhatsApp.correlation);
  assert.equal(await queueCazooLeadForward(beforeWhatsApp.row, beforeWhatsApp.email), "queued");
  const previousVehicle = {
    name: "Audi A5", trim: "S line", year: "2013", mileage: "76,000 miles", fuel: "Diesel",
    gearbox: "Automatic", websitePrice: "£5,990", photoUrl: photo,
  };
  const previousVehicleContent = renderCazooForwardEmail(
    structuredSubject, beforeWhatsApp.email.text, [], undefined, "current",
    { origin: tenantOrigin, enquiryId: beforeWhatsApp.enquiryId }, previousVehicle,
  );
  const oldVehicleRequest = await runWithTenant(tenant, () => prepareEmailWithSettings(
    { enabled: true, apiKey: "re_fictional_only", from: "Fictional Motors <sales@example.test>", replyTo: "" },
    { ...previousVehicleContent, to: recipient, idempotencyKey: `cazoo-lead-forward-${beforeWhatsApp.row.id}` },
  ));
  const oldVehicleEmail = JSON.stringify(oldVehicleRequest.body);
  const oldVehiclePayload = JSON.stringify({ version: "vehicle-v1", vehicle: previousVehicle, email: oldVehicleEmail });
  await engine.query("UPDATE cazoo_lead_forwards SET attempts=1,payload=$2,payload_hash=$3,account_hash=$4 WHERE receipt_id=$1", [
    beforeWhatsApp.row.id, oldVehiclePayload, createHash("sha256").update(oldVehiclePayload).digest("hex"), emailAccountHash(oldVehicleRequest.config),
  ]);
  await processCazooLeadForwards({ send: async (_settings, payload) => {
    assert.equal(payload, oldVehicleEmail);
    assert.doesNotMatch(payload, /WhatsApp|enquiryAction=whatsapp/);
    return "fixture-before-whatsapp-retry";
  } });
  assert.equal((await delivery(beforeWhatsApp.row.id))?.status, "sent");

  const beforeDirect = await receipt({ status: "imported", error: null });
  beforeDirect.email.subject = structuredSubject.replace(/^Cazoo lead: /, "");
  beforeDirect.email.text = structuredLead("buyer@example.test").replace(/22222222222222222222222222222222/, beforeDirect.correlation);
  assert.equal(await queueCazooLeadForward(beforeDirect.row, beforeDirect.email), "queued");
  const previousWhatsApp = renderCazooForwardEmail(
    structuredSubject, beforeDirect.email.text, [], undefined, "current",
    { origin: tenantOrigin, enquiryId: beforeDirect.enquiryId }, previousVehicle, { whatsapp: "legacy" },
  );
  const oldWhatsAppRequest = await runWithTenant(tenant, () => prepareEmailWithSettings(
    { enabled: true, apiKey: "re_fictional_only", from: "Fictional Motors <sales@example.test>", replyTo: "" },
    { ...previousWhatsApp, to: recipient, idempotencyKey: `cazoo-lead-forward-${beforeDirect.row.id}` },
  ));
  const oldWhatsAppEmail = JSON.stringify(oldWhatsAppRequest.body);
  const oldWhatsAppPayload = JSON.stringify({ version: "whatsapp-v1", vehicle: previousVehicle, email: oldWhatsAppEmail });
  await engine.query("UPDATE cazoo_lead_forwards SET attempts=1,payload=$2,payload_hash=$3,account_hash=$4 WHERE receipt_id=$1", [
    beforeDirect.row.id, oldWhatsAppPayload, createHash("sha256").update(oldWhatsAppPayload).digest("hex"), emailAccountHash(oldWhatsAppRequest.config),
  ]);
  await processCazooLeadForwards({ send: async (_settings, payload) => {
    assert.equal(payload, oldWhatsAppEmail);
    assert.match(payload, /enquiryAction=whatsapp/);
    return "fixture-before-direct-whatsapp-retry";
  } });
  assert.equal((await delivery(beforeDirect.row.id))?.status, "sent");

  const unrelatedStock = await receipt({ status: "imported", error: null });
  unrelatedStock.email.subject = structuredSubject.replace(/^Cazoo lead: /, "");
  unrelatedStock.email.text = structuredLead("buyer@example.test").replace(/22222222222222222222222222222222/, unrelatedStock.correlation);
  await engine.query("UPDATE vehicles SET dealer_id=$2 WHERE id=$1", [picturedVehicle, secondDealer]);
  await engine.query("UPDATE vehicle_images SET is_active=true WHERE vehicle_id=$1", [picturedVehicle]);
  await engine.query("UPDATE enquiries SET vehicle_id=$2 WHERE id=$1", [unrelatedStock.enquiryId, picturedVehicle]);
  assert.equal(await queueCazooLeadForward(unrelatedStock.row, unrelatedStock.email), "queued");
  await processCazooLeadForwards({ send: async (_settings, payload) => {
    const email = JSON.parse(payload);
    assert.match(email.text, /Audi A5 · £5,490/);
    assert.doesNotMatch(email.html, /<img|90,000 miles|S line/);
    return "fixture-unrelated-stock";
  } });
  assert.equal((await delivery(unrelatedStock.row.id))?.status, "sent");

  const partExchangeWithConflictingEmail = renderCazooForwardEmail(partExchangeSubject, partExchangeLead("buyer@example.test ( different@example.test )"));
  assert.equal(partExchangeWithConflictingEmail.replyTo, undefined);
  assert.match(partExchangeWithConflictingEmail.text, /Customer email unavailable/);

  const noEmail = await receipt({ status: "imported", error: "customer_email_missing" });
  noEmail.email.subject = structuredSubject.replace(/^Cazoo lead: /, "");
  noEmail.email.text = structuredLead("buyer@example.test ( different@example.test )").replace(/22222222222222222222222222222222/, noEmail.correlation);
  assert.equal(await queueCazooLeadForward(noEmail.row, noEmail.email), "queued");
  await processCazooLeadForwards({ send: async (_settings, payload) => {
    const email = JSON.parse(payload);
    assert.equal(email.reply_to, undefined);
    assert.match(email.text, /Customer email unavailable/);
    assert.ok(email.text.includes(`Add customer email\n${tenantOrigin}/portal?section=notifications&workView=customers&enquiryId=${noEmail.enquiryId}&enquiryAction=fix-email`));
    assert.equal(whatsappLink(email.text).searchParams.get("text"), "Audi A5\nMW62 VLP\n\nHi Fictional,\n\n");
    assert.doesNotMatch(email.html, /enquiryAction=reply|buyer@example\.test|different@example\.test/);
    return "fixture-add-email";
  } });
  assert.equal((await delivery(noEmail.row.id))?.status, "sent");

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

  const beforePortalActions = await receipt({ status: "imported", error: null, customerEmail: "buyer@example.test" });
  beforePortalActions.email.subject = partExchangeSubject.replace(/^Cazoo lead: /, "");
  beforePortalActions.email.text = partExchangeLead("buyer@example.test").replace(/22222222222222222222222222222222/, beforePortalActions.correlation);
  assert.equal(await queueCazooLeadForward(beforePortalActions.row, beforePortalActions.email), "queued");
  const oldPortalContent = renderCazooForwardEmail(partExchangeSubject, beforePortalActions.email.text);
  const oldPortalRequest = await runWithTenant(tenant, () => prepareEmailWithSettings(
    { enabled: true, apiKey: "re_fictional_only", from: "Fictional Motors <sales@example.test>", replyTo: "" },
    { ...oldPortalContent, to: recipient, idempotencyKey: `cazoo-lead-forward-${beforePortalActions.row.id}` },
  ));
  const oldPortalPayload = JSON.stringify(oldPortalRequest.body);
  await engine.query("UPDATE cazoo_lead_forwards SET attempts=1,payload=$2,payload_hash=$3,account_hash=$4 WHERE receipt_id=$1", [
    beforePortalActions.row.id, oldPortalPayload, createHash("sha256").update(oldPortalPayload).digest("hex"), emailAccountHash(oldPortalRequest.config),
  ]);
  await processCazooLeadForwards({ send: async (_settings, payload, key) => {
    assert.equal(payload, oldPortalPayload);
    assert.equal(key, `cazoo-lead-forward-${beforePortalActions.row.id}`);
    assert.doesNotMatch(payload, /enquiryAction=/);
    return "fixture-before-portal-retry";
  } });
  assert.equal((await delivery(beforePortalActions.row.id))?.status, "sent");

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
