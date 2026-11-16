import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  db, engine, dealershipsTable, dealerSettingsTable, vehiclesTable,
} from "./test/tenant-test-db";
import { dealerIntegrationsStore } from "./lib/dealer-integrations-store";
import { deliverStockMotRenewalNotices, renderStockMotRenewalEmail } from "./lib/mot-stock-renewal-mail";
import { runWithTenant, type TenantContext } from "./lib/tenant-context";

const photo = "https://m.atcdn.co.uk/a/media/w800/fixture-mot.jpg";
const vehicleId = "11111111-1111-4111-8111-111111111111";

test("the MOT email includes the official car photo, new expiry and staff car link", () => {
  const email = renderStockMotRenewalEmail({
    to: "dealer@example.test", dealerName: "Kirk & Co", vehicleId,
    registration: "AB12CDE", expiryDate: "2027-05-01",
    advisories: ["Tyre wear <near legal limit>", "Slight play in a ball joint"],
    vehicle: { make: "Ford", model: "Focus", year: 2012, heroImage: "javascript:bad()", images: [photo] },
    origin: "https://dealer.example.test", idempotencyKey: "mot-renewal-fixture",
  });
  assert.equal(email.subject, "MOT renewed: 2012 Ford Focus (AB12 CDE)");
  assert.match(email.html, /Kirk &amp; Co/);
  assert.ok(email.html.includes(`<img src="${photo}"`));
  assert.doesNotMatch(email.html, /javascript:/);
  assert.match(email.html, /New MOT expiry: <strong>1 May 2027<\/strong>/);
  assert.match(email.text!, /New MOT expiry: 1 May 2027/);
  assert.match(email.html, /Advisories from this test/);
  assert.match(email.html, /Tyre wear &lt;near legal limit&gt;/);
  assert.doesNotMatch(email.html, /<near legal limit>/);
  assert.match(email.text!, /- Tyre wear <near legal limit>/);
  assert.match(email.text!, /- Slight play in a ball joint/);
  assert.ok(email.text!.includes(`https://dealer.example.test/portal?section=cars&carId=${vehicleId}`));
});

test("renewals are sent to the scoped dealer with stable retries and only while the car is in their current feed", async () => {
  process.env.MULTI_TENANT_ENABLED = "true";
  process.env.NODE_ENV = "test";
  process.env.INTEGRATIONS_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("External delivery is forbidden in this test"); };
  const first: TenantContext = {
    dealerId: "mot-notice-dealer-a", canonicalOrigin: "https://dealer-a.example.test",
    platform: "autotrader", retailerId: "dealer-a",
    sourceUrl: "https://www.autotrader.co.uk/retailer/dealer-a",
  };
  const second: TenantContext = {
    ...first, dealerId: "mot-notice-dealer-b", canonicalOrigin: "https://dealer-b.example.test",
    platform: "cazoo", retailerId: "dealer-b", sourceUrl: "https://www.cazoo.co.uk/dealers/dealer-b",
  };
  const previousRecipients = process.env.MOT_RENEWAL_EMAIL_RECIPIENTS;
  process.env.MOT_RENEWAL_EMAIL_RECIPIENTS = JSON.stringify({
    [second.dealerId]: "mot-alerts@example.test",
  });
  const sends: { payload: string; key: string | null }[] = [];
  let failNext = false;
  const transport: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    sends.push({ payload: String(init?.body), key: new Headers(init?.headers).get("idempotency-key") });
    if (failNext) {
      failNext = false;
      throw new Error("Provider acceptance uncertain");
    }
    return Response.json({ id: "fixture-provider-" + sends.length });
  };

  try {
    for (const file of (await readdir("../../lib/db/drizzle")).filter(name => /^\d.*\.sql$/.test(name)).sort()) {
      await engine.exec(await readFile("../../lib/db/drizzle/" + file, "utf8"));
    }
    for (const tenant of [first, second]) {
      await db.insert(dealershipsTable).values({
        id: tenant.dealerId, name: "Fixture Showroom", status: "active",
        canonicalOrigin: tenant.canonicalOrigin, stockPlatform: tenant.platform,
        retailerId: tenant.retailerId, sourceUrl: tenant.sourceUrl,
      });
      await db.insert(dealerSettingsTable).values({
        dealerId: tenant.dealerId,
        config: { identity: { name: "Fixture Showroom" }, contact: { email: tenant.retailerId + "@example.test" } },
      });
      await runWithTenant(tenant, () => dealerIntegrationsStore.update({
        expectedRevision: 0,
        resend: { enabled: true, apiKey: "re_fictional_" + tenant.retailerId, from: "alerts@example.test", replyTo: "" },
      }));
    }

    async function addNotice(tenant: TenantContext, advertId: string, car?: Partial<typeof vehiclesTable.$inferInsert>) {
      const [vehicle] = await db.insert(vehiclesTable).values({
        dealerId: tenant.dealerId, source: tenant.platform, advertId, registration: "AB12CDE",
        make: "Ford", model: advertId, year: 2012, sourcePrice: 7000, sourceHeroImage: photo, ...car,
      }).returning();
      await engine.query(
        "INSERT INTO mot_stock_renewal_notices(dealer_id,vehicle_id,registration,expiry_date) VALUES($1,$2,'AB12CDE','2027-05-01')",
        [tenant.dealerId, vehicle.id],
      );
      return vehicle.id;
    }
    async function status(vehicle: string) {
      const { rows } = await engine.query<{status: string}>("SELECT status FROM mot_stock_renewal_notices WHERE vehicle_id=$1", [vehicle]);
      return rows[0]?.status;
    }
    const send = (tenant = first) => runWithTenant(tenant, () => deliverStockMotRenewalNotices({ warn() {} }, { transport }));
    const grace = await addNotice(first, "Missing within grace period", { missingCount: 1 });
    const gone = await addNotice(first, "Removed from feed", { sourceStatus: "missing" });
    const changed = await addNotice(first, "Registration changed", { plate: "CD34EFG" });
    const live = await addNotice(first, "Focus", { inventoryStatus: "reserved" });
    await engine.query("UPDATE mot_stock_renewal_notices SET advisories=$2 WHERE vehicle_id=$1", [
      live, ["Slight play in a ball joint"],
    ]);
    const other = await addNotice(second, "Other dealership");

    failNext = true;
    await send();
    assert.equal(sends.length, 1);
    const firstEmail = JSON.parse(sends[0]!.payload);
    assert.deepEqual(firstEmail.to, ["dealer-a@example.test"]);
    assert.match(firstEmail.subject, /Ford Focus/);
    assert.ok(firstEmail.html.includes(photo));
    assert.match(firstEmail.html, /1 May 2027/);
    assert.match(firstEmail.html, /Advisories from this test/);
    assert.match(firstEmail.html, /Slight play in a ball joint/);
    assert.match(firstEmail.text, /- Slight play in a ball joint/);
    for (const ineligible of [grace, gone, changed]) assert.equal(await status(ineligible), "skipped");
    assert.equal(await status(other), "queued");

    // The same stored message retries even if the stock display details changed.
    await engine.query("UPDATE vehicles SET title='New display name' WHERE id=$1", [live]);
    await engine.query("UPDATE mot_stock_renewal_notices SET next_attempt_at=now() WHERE vehicle_id=$1", [live]);
    await Promise.all([send(), send()]);
    assert.equal(sends.length, 2);
    assert.deepEqual(sends[1], sends[0]);
    assert.equal(await status(live), "sent");

    const removedBeforeRetry = await addNotice(first, "Removed before retry");
    failNext = true;
    await send();
    assert.equal(sends.length, 3);
    const noAdvisoryEmail = JSON.parse(sends[2]!.payload);
    assert.doesNotMatch(noAdvisoryEmail.html, /Advisories from this test/);
    assert.doesNotMatch(noAdvisoryEmail.text, /Advisories from this test/);
    await engine.query("UPDATE vehicles SET missing_count=1 WHERE id=$1", [removedBeforeRetry]);
    await engine.query("UPDATE mot_stock_renewal_notices SET next_attempt_at=now() WHERE vehicle_id=$1", [removedBeforeRetry]);
    await send();
    assert.equal(sends.length, 3);
    assert.equal(await status(removedBeforeRetry), "skipped");
    assert.equal(await status(other), "queued");

    const setLegacyCazooEnabled = (enabled: boolean) => runWithTenant(second, async () => {
      const { revision } = await dealerIntegrationsStore.readStockConnection();
      await dealerIntegrationsStore.updateStockConnection({
        expectedRevision: revision,
        connection: { platform: second.platform, retailerId: second.retailerId, sourceUrl: second.sourceUrl, enabled },
      });
    });
    await setLegacyCazooEnabled(false);
    const legacyPaused = await addNotice(second, "Legacy importer paused");
    await send(second);
    assert.equal(await status(other), "skipped");
    assert.equal(await status(legacyPaused), "skipped");
    assert.equal(sends.length, 3);

    await engine.query(
      "INSERT INTO cazoo_feed_authority(dealer_id,retailer_id,feed_id,enabled) VALUES($1,$2,'AETA123',true)",
      [second.dealerId, second.retailerId],
    );
    const activeCazoo = await addNotice(second, "Active official Cazoo");
    await engine.query("UPDATE mot_stock_renewal_notices SET advisories=$2 WHERE vehicle_id=$1", [
      activeCazoo, ["Rear tyre worn"],
    ]);
    const missingCazoo = await addNotice(second, "Missing from official Cazoo", { missingCount: 1 });
    await send(second);
    assert.equal(await status(activeCazoo), "sent");
    assert.equal(await status(missingCazoo), "skipped");
    assert.equal(sends.length, 4);
    const cazooEmail = JSON.parse(sends[3]!.payload);
    assert.deepEqual(cazooEmail.to, ["mot-alerts@example.test"]);
    assert.match(cazooEmail.html, /Rear tyre worn/);
    assert.match(cazooEmail.text, /- Rear tyre worn/);

    await setLegacyCazooEnabled(true);
    await engine.query("UPDATE cazoo_feed_authority SET enabled=false WHERE dealer_id=$1", [second.dealerId]);
    const pausedCazoo = await addNotice(second, "Official Cazoo paused");
    await send(second);
    assert.equal(await status(pausedCazoo), "skipped");
    await engine.query("UPDATE cazoo_feed_authority SET enabled=true,retailer_id='different-dealer' WHERE dealer_id=$1", [second.dealerId]);
    const mismatchedCazoo = await addNotice(second, "Official Cazoo retailer changed");
    await send(second);
    assert.equal(await status(mismatchedCazoo), "skipped");
    assert.equal(sends.length, 4);
  } finally {
    globalThis.fetch = realFetch;
    if (previousRecipients === undefined) delete process.env.MOT_RENEWAL_EMAIL_RECIPIENTS;
    else process.env.MOT_RENEWAL_EMAIL_RECIPIENTS = previousRecipients;
    await engine.close();
  }
});
