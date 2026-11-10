import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { dealerIntegrationsStore } from "./lib/dealer-integrations-store";
import { deliverEmailOutbox } from "./lib/email-outbox";
import { runWithTenant } from "./lib/tenant-context";
import { queueCazooAutomaticFirstReply } from "./routes/enquiry-emails";
import { engine } from "./test/tenant-test-db";

const tenant = {
  dealerId: "cazoo-fixture",
  canonicalOrigin: "https://dealer.example.test",
  platform: "cazoo" as const,
  retailerId: "fictional-retailer",
  sourceUrl: "https://www.cazoo.co.uk/fictional-retailer",
};
const mailbox = "cazoo@leads.example.test";
const domain = "replies.example.test";
const buyer = "buyer@example.test";
const vehicle = randomUUID();
const stockRun = randomUUID();

test("only a new, eligible Cazoo receipt gets one routed automatic reply", async (t) => {
  const originalFetch = globalThis.fetch;
  let externalRequests = 0;
  globalThis.fetch = async () => {
    externalRequests++;
    throw new Error("This test only allows its recording email transport.");
  };
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await engine.close();
    assert.equal(externalRequests, 0);
  });
  Object.assign(process.env, {
    NODE_ENV: "test",
    MULTI_TENANT_ENABLED: "true",
    INTEGRATIONS_ENCRYPTION_KEY: Buffer.alloc(32, 18).toString("base64"),
    CAZOO_LEADS_ENABLED: "true",
    CAZOO_LEAD_MAILBOXES: JSON.stringify({ [tenant.dealerId]: mailbox }),
    AI_ASSISTANCE_ENABLED: "true",
    OPENAI_API_KEY: "fictional-only",
    AI_ENQUIRY_AUTOMATION: JSON.stringify({ [tenant.dealerId]: { provider: "cazoo", enabled: true } }),
    AI_CAZOO_AUTOMATIC_REPLY_DEALERS: JSON.stringify({ [tenant.dealerId]: new Date(Date.now() - 300_000).toISOString() }),
    EMAIL_REPLIES_ENABLED: "true",
    EMAIL_REPLY_DOMAINS: JSON.stringify({ [tenant.dealerId]: domain }),
    RESEND_RECEIVING_API_KEY: "re_fictional_receiver",
    RESEND_RECEIVING_WEBHOOK_SECRET: "fictional-reply-verification",
  });
  for (const file of (await readdir("../../lib/db/drizzle")).filter((f) => /^\d+.*\.sql$/.test(f)).sort())
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  await engine.query(
    "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Fictional Motors','active',$2,'cazoo',$3,$4)",
    [tenant.dealerId, tenant.canonicalOrigin, tenant.retailerId, tenant.sourceUrl],
  );
  await engine.query("INSERT INTO dealer_settings(dealer_id,config) VALUES($1,$2::jsonb)", [tenant.dealerId, JSON.stringify({ identity: { name: "Fictional Motors" } })]);
  await engine.query(
    "INSERT INTO stock_import_runs(id,run_id,dealer_id,source,retailer_id,schema_version,scraped_at,expected_count,received_count,complete,status,raw_snapshot) VALUES($1,$2,$3,'cazoo',$4,'1',now(),1,1,true,'completed','{}'::jsonb)",
    [stockRun, randomUUID(), tenant.dealerId, tenant.retailerId],
  );
  await engine.query(
    "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,registration,import_run_id) VALUES($1,$2,'cazoo','fixture-advert','Lexus RX','AB15 CDE',$3)",
    [vehicle, tenant.dealerId, stockRun],
  );

  async function imported({ message = "Is this still available?", error = null, age = 0 }: { message?: string; error?: string | null; age?: number } = {}) {
    const enquiry = randomUUID(), id = randomUUID();
    await engine.query(
      "INSERT INTO enquiries(id,dealer_id,source,type,customer_name,email,preferred_contact,message,vehicle_id,vehicle_registration) VALUES($1,$2,'cazoo','general','Fictional Buyer',$3,'email',$4,$5,'AB15CDE')",
      [enquiry, tenant.dealerId, buyer, message, vehicle],
    );
    await engine.query(
      "INSERT INTO cazoo_lead_receipts(id,dealer_id,provider_id,mailbox,status,enquiry_id,correlation_id,error_code,received_at) VALUES($1,$2,$3,$4,'imported',$5,$6,$7,now()-($8::int*interval '1 minute'))",
      [id, tenant.dealerId, randomUUID(), mailbox, enquiry, randomUUID().replace(/-/g, ""), error, age],
    );
    return { id, dealer_id: tenant.dealerId, enquiry_id: enquiry, mailbox, error_code: error };
  }

  await runWithTenant(tenant, async () => {
    await dealerIntegrationsStore.update({
      expectedRevision: 0,
      resend: { enabled: true, apiKey: "re_fictional_only", from: "Fictional Motors <sales@example.test>", replyTo: "sales@example.test" },
    });
    const partExchange = await imported();
    await engine.query("UPDATE enquiries SET type='part_exchange' WHERE id=$1", [partExchange.enquiry_id]);
    assert.equal(await queueCazooAutomaticFirstReply(partExchange), false);
    const receipt = await imported();
    const outcomes = await Promise.all([queueCazooAutomaticFirstReply(receipt), queueCazooAutomaticFirstReply(receipt)]);
    assert.deepEqual(outcomes, [true, true]);
    const queued = (await engine.query<{ id: string; send_key: string; payload: string }>(
      "SELECT id,send_key,payload FROM email_outbox WHERE enquiry_id=$1", [receipt.enquiry_id],
    )).rows;
    assert.equal(queued.length, 1);
    const [{ id, send_key: sendKey, payload }] = queued;
    let attempts = 0;
    const sent = await deliverEmailOutbox(id, {
      send: async (_settings, body, key) => {
        attempts++;
        assert.equal(body, payload);
        assert.equal(key, sendKey);
        const envelope = JSON.parse(body);
        assert.deepEqual(envelope.to, [buyer]);
        assert.match(envelope.text, /the Lexus RX \(AB15CDE\) is currently available/);
        assert.ok(envelope.reply_to.endsWith(`@${domain}`));
        return "fictional-provider-id";
      },
    });
    assert.equal(sent?.status, "sent");
    assert.equal(attempts, 1);
    assert.equal(await queueCazooAutomaticFirstReply(receipt), true);

    const unsafe = [
      await imported({ message: "Is this available and would you take £5,000?" }),
      await imported({ error: "owner_test" }),
      await imported({ age: 8 }),
      await imported({ age: 17 }),
    ];
    for (const lead of unsafe) assert.equal(await queueCazooAutomaticFirstReply(lead), false);

    const changedStock = await imported();
    assert.equal(await queueCazooAutomaticFirstReply(changedStock), true);
    await engine.query("UPDATE vehicles SET inventory_status='reserved' WHERE id=$1", [vehicle]);
    const changedId = (await engine.query<{ id: string }>("SELECT id FROM email_outbox WHERE enquiry_id=$1", [changedStock.enquiry_id])).rows[0]!.id;
    const stopped = await deliverEmailOutbox(changedId, {
      now: new Date(Date.now() + 2_000),
      send: async () => { attempts++; return "unexpected-send"; },
    });
    assert.equal(stopped?.status, "failed");
    assert.equal(attempts, 1);

    // A current unchanged check can verify the last applied official stock file.
    const officialHash = "a".repeat(64), previousCheck = randomUUID();
    await engine.query("INSERT INTO cazoo_feed_authority(dealer_id,retailer_id,feed_id,enabled) VALUES($1,$2,'AETA123',true)", [tenant.dealerId, tenant.retailerId]);
    await engine.query("UPDATE stock_import_runs SET scraped_at=now()-interval '2 days',run_id=$2 WHERE id=$1", [stockRun, `cazoo-csv:${tenant.dealerId}:fixture:${officialHash}`]);
    await engine.query("UPDATE vehicles SET inventory_status='available' WHERE id=$1", [vehicle]);
    await engine.query(`INSERT INTO cazoo_feed_checks(id,dealer_id,slot_key,status,received_at,completed_at,file_hash,vehicle_count,candidate)
      VALUES($1,$2,'previous','ready',now()-interval '2 days',now()-interval '2 days',$3,1,$4::jsonb)`,
      [previousCheck, tenant.dealerId, officialHash, JSON.stringify({ metadata: { feedId: "AETA123", retailerId: tenant.retailerId } })]);
    assert.equal(await queueCazooAutomaticFirstReply(await imported()), false);
    await engine.query(`INSERT INTO cazoo_feed_checks(dealer_id,slot_key,status,received_at,completed_at,file_hash,vehicle_count,based_on_check_id)
      VALUES($1,'current','unchanged',now(),now(),$2,1,$3)`, [tenant.dealerId, officialHash, previousCheck]);
    const officialLead = await imported();
    assert.equal(await queueCazooAutomaticFirstReply(officialLead), true);
    // A more recent unverified check blocks both a fresh queue and an already approved delivery.
    await engine.query(`INSERT INTO cazoo_feed_checks(dealer_id,slot_key,status,received_at,completed_at,file_hash,vehicle_count,candidate)
      VALUES($1,'newer','ready',now(),now(),$2,1,$3::jsonb)`,
      [tenant.dealerId, "b".repeat(64), JSON.stringify({ metadata: { feedId: "AETA123", retailerId: tenant.retailerId } })]);
    assert.equal(await queueCazooAutomaticFirstReply(await imported()), false);
    const officialId = (await engine.query<{ id: string }>("SELECT id FROM email_outbox WHERE enquiry_id=$1", [officialLead.enquiry_id])).rows[0]!.id;
    const unapplied = await deliverEmailOutbox(officialId, {
      now: new Date(Date.now() + 4_000),
      send: async () => { attempts++; return "unexpected-send"; },
    });
    assert.equal(unapplied?.status, "failed");
    assert.equal(attempts, 1);
  });
});
