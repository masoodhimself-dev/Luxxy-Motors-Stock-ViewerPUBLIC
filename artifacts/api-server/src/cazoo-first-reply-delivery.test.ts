import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { cazooFirstReplyActor } from "./lib/cazoo-automatic-first-reply";
import { deliverEmailOutbox } from "./lib/email-outbox";
import { runWithTenant } from "./lib/tenant-context";
import { engine } from "./test/tenant-test-db";

const tenant = {
  dealerId: "cazoo-fixture",
  canonicalOrigin: "https://dealer.example.test",
  platform: "cazoo" as const,
  retailerId: "fixture-retailer",
  sourceUrl: "https://www.cazoo.co.uk/fixture-retailer",
};
const buyer = "buyer@example.test";
const retirementMigration = "0093_retire_cazoo_automatic_replies.sql";

test("queued automatic Cazoo replies stop before contacting the provider", async (t) => {
  t.after(() => engine.close());
  process.env.MULTI_TENANT_ENABLED = "true";
  for (const file of (await readdir("../../lib/db/drizzle")).filter(
    (name) => /^\d+.*\.sql$/.test(name) && name !== retirementMigration,
  ).sort()) {
    await engine.exec(await readFile(`../../lib/db/drizzle/${file}`, "utf8"));
  }
  await engine.query(
    "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Fictional Motors','active',$2,'cazoo',$3,$4)",
    [tenant.dealerId, tenant.canonicalOrigin, tenant.retailerId, tenant.sourceUrl],
  );

  async function fixture(status: "queued" | "sent", attempts: number, automatic = true, scheduled = false) {
    const enquiryId = randomUUID(), deliveryId = randomUUID(), id = randomUUID(), requestId = randomUUID();
    await engine.query(
      "INSERT INTO enquiries(id,dealer_id,source,type,customer_name,email,preferred_contact,message) VALUES($1,$2,'cazoo','general','Fictional Buyer',$3,'email','Is this still available?')",
      [enquiryId, tenant.dealerId, buyer],
    );
    await engine.query(
      `INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,created_by,provider_id)
       VALUES($1,$2,$3,$4,'fixture-hash',$5,$6,'Availability','Fictional reply',$7,$8)`,
      [deliveryId, tenant.dealerId, enquiryId, requestId, status === "sent" ? "sent" : "sending", buyer,
        automatic ? cazooFirstReplyActor : "fixture-staff", status === "sent" ? "old-provider" : null],
    );
    await engine.query(
      `INSERT INTO email_outbox(id,dealer_id,enquiry_id,delivery_id,kind,send_key,payload_hash,validation_hash,validation,account_hash,status,attempts,next_attempt_at,retry_deadline,provider_id)
       VALUES($1,$2,$3,$4,'staff',$5,'fixture-hash','fixture-hash',$6::jsonb,'fixture-account',$7,$8,$9,now()+interval '1 hour',$10)`,
      [id, tenant.dealerId, enquiryId, deliveryId, automatic ? `cazoo-first-reply-${requestId}` : `staff-${requestId}`,
        JSON.stringify(automatic ? { cazooFirstReply: { receiptId: requestId } } : {}),
        status, attempts, new Date(Date.now() + (scheduled ? 300_000 : -5_000)), status === "sent" ? "old-provider" : null],
    );
    return { id, deliveryId };
  }

  const oldPending = await fixture("queued", 0, true, true);
  const oldRetry = await fixture("queued", 1, true, true);
  const sent = await fixture("sent", 1);
  const manual = await fixture("queued", 0, false);
  await engine.exec(await readFile(`../../lib/db/drizzle/${retirementMigration}`, "utf8"));

  const results = (await engine.query<{ id: string; status: string; error_code: string | null; provider_id: string | null }>(
    "SELECT id,status,error_code,provider_id FROM email_outbox",
  )).rows;
  const message = async (delivery: string) => (await engine.query<{status: string; error: string | null}>(
    "SELECT status,error FROM enquiry_emails WHERE id=$1", [delivery],
  )).rows[0]!;
  assert.equal(results.find((row) => row.id === oldPending.id)?.status, "failed");
  assert.equal(results.find((row) => row.id === oldRetry.id)?.status, "unknown");
  for (const fixture of [oldPending, oldRetry]) {
    assert.equal(results.find((row) => row.id === fixture.id)?.error_code, "cazoo_automatic_reply_retired");
  }
  assert.deepEqual(results.find((row) => row.id === sent.id), {
    id: sent.id, status: "sent", error_code: null, provider_id: "old-provider",
  });
  assert.equal(results.find((row) => row.id === manual.id)?.status, "queued");
  assert.equal((await message(manual.deliveryId)).status, "sending");
  assert.equal((await message(oldPending.deliveryId)).status, "failed");
  assert.match((await message(oldPending.deliveryId)).error!, /automatic Cazoo reply was stopped/);
  assert.equal((await message(oldRetry.deliveryId)).status, "unknown");
  assert.match((await message(oldRetry.deliveryId)).error!, /may have been sent/);

  // A worker from the previous version could enqueue a row during a rolling deploy.
  // The runtime guard stops it even after the migration has already finished.
  const latePending = await fixture("queued", 0);
  const lateRetry = await fixture("queued", 1);
  let providerCalls = 0;
  const unexpectedProviderCall = async () => {
    providerCalls++;
    throw new Error("The old automatic reply should stop before contacting the provider.");
  };
  const expectNoProviderOrPreparation = {
    settings: unexpectedProviderCall,
    rebuild: unexpectedProviderCall,
    send: unexpectedProviderCall,
  };
  await runWithTenant(tenant, async () => {
    assert.equal((await deliverEmailOutbox(latePending.id, expectNoProviderOrPreparation))?.status, "failed");
    assert.equal((await deliverEmailOutbox(lateRetry.id, expectNoProviderOrPreparation))?.status, "unknown");
  });
  assert.equal((await message(latePending.deliveryId)).status, "failed");
  assert.equal((await message(lateRetry.deliveryId)).status, "unknown");
  assert.equal(providerCalls, 0);
});
