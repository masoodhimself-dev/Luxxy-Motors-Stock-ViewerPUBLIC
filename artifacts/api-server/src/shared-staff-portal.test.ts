import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer, request } from "node:http";
import test from "node:test";
import express, { Router } from "express";
import { engine } from "./test/tenant-test-db";
import { createSharedStaffPortal } from "./routes/shared-staff-portal";
import dealerOperations from "./routes/dealer-operations";
import { currentTenant } from "./lib/tenant-context";
import { sharedStaffWorkspaceUrl } from "./lib/shared-staff-portal";
import { acceptAccountInvitation, issueAccountInvitation, readAccountInvitation } from "./lib/account-invitations";

const central = "staff.example.test";
process.env.MULTI_TENANT_ENABLED = "true";
process.env.STAFF_PORTAL_HOST = central;
process.env.STAFF_PORTAL_CLERK_PUBLISHABLE_KEY = "pk_live_fictional";
process.env.STAFF_PORTAL_CLERK_SECRET_KEY = "sk_live_fictional";
process.env.STAFF_PORTAL_PILOT_DEALER_ID = "dealer-one";
process.env.PLATFORM_ADMIN_USER_IDS = "user_platform_fixture";
process.env.RESEND_API_KEY = "re_fictional_no_network";
process.env.RESEND_FROM_EMAIL = "accounts@example.test";

test("shared staff portal scopes every workspace to the pilot and a current Full Portal membership", async (t) => {
  const migrations = "../../lib/db/drizzle";
  for (const file of (await readdir(migrations)).filter((name) => /^\d+.*\.sql$/.test(name)).sort()) {
    await engine.exec(await readFile(`${migrations}/${file}`, "utf8"));
  }
  for (const [id, label, plan, status] of [
    ["dealer-one", "Dealer One", "full_portal", "active"],
    ["dealer-two", "Dealer Two", "full_portal", "active"],
    ["dealer-other", "Other Dealer", "full_portal", "active"],
    ["website-only", "Website Only", "website_only", "active"],
    ["archived-dealer", "Suspended Dealer", "full_portal", "suspended"],
    ["planned-dealer", "Planned Dealer", "full_portal", "draft"],
  ]) {
    await engine.query(`INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url,plan,enquiry_email)
      VALUES($1,$2,$3,$4,'cazoo','fixture-retailer','https://example.test/feed',$5,'enquiries@example.test')`,
    [id, label, status, `https://${id}.example.test`, plan]);
  }
  await engine.exec("UPDATE dealerships SET onboarding_required=true WHERE id='planned-dealer'");
  await engine.exec(`INSERT INTO portal_users(dealer_id,auth_user_id,role,email,name,shared_staff_identity) VALUES
    ('dealer-one','user_fixture','owner','owner@example.test','Fictional Owner',true),
    ('dealer-one','user_legacy','owner','owner@example.test','Fictional Owner',false),
    ('dealer-two','user_fixture','accounts','owner@example.test','Fictional Owner',true),
    ('dealer-other','user_other','owner','other@example.test','Other Owner',true),
    ('website-only','user_fixture','owner','owner@example.test','Fictional Owner',true),
    ('archived-dealer','user_fixture','owner','owner@example.test','Fictional Owner',true)`);
  const api = Router();
  api.all("/staff/test-scope", (req, res) => {
    res.json({ dealer: currentTenant()?.dealerId, role: req.staff?.role, origin: req.get("origin") });
  });
  api.get("/enquiries/availability", (_req, res) => { res.json({ dealer: currentTenant()?.dealerId }); });
  api.get("/ai/status", (_req, res) => { res.json({ dealer: currentTenant()?.dealerId }); });
  api.post("/ai/assist", (_req, res) => { res.json({ dealer: currentTenant()?.dealerId }); });
  api.get("/staff/push", (_req, res) => { res.sendStatus(200); });
  api.use(dealerOperations);
  const app = express();
  app.use(express.json());
  app.use(createSharedStaffPortal(api, Router()));
  app.get(["/api/healthz", "/api/readyz"], (_req, res) => { res.json({ healthy: true }); });
  app.use((_req, res) => { res.json({ legacy: !res.locals.sharedStaffPortal, canonical: currentTenant()?.canonicalOrigin }); });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address.");
  const call = (path: string, options: { user?: string; host?: string; origin?: string; method?: string; body?: Record<string, unknown> } = {}) => new Promise<Response>((resolve, reject) => {
    const req = request(`http://127.0.0.1:${address.port}${path}`, {
      method: options.method,
      headers: {
        host: options.host ?? central,
        ...(options.user ? { "x-test-user": options.user } : {}),
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString();
        resolve(new Response(body || null, { status: response.statusCode, headers: { "cache-control": response.headers["cache-control"] ?? "" } }));
      });
    });
    req.on("error", reject);
    req.end(options.body ? JSON.stringify(options.body) : undefined);
  });
  const staff = { user: "user_fixture" };
  try {
    assert.deepEqual(await (await call("/api/healthz")).json(), { healthy: true });
    assert.equal((await call("/api/readyz", { method: "HEAD" })).status, 200);
    assert.equal((await call("/api/healthz", { method: "POST" })).status, 404);
    assert.equal((await call("/api/staff-portal/memberships")).status, 401);
    assert.deepEqual(await (await call("/api/staff-portal/memberships", { user: "user_legacy" })).json(), { dealerships: [] });
    const memberships = await call("/api/staff-portal/memberships", staff);
    assert.equal(memberships.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(await memberships.json(), { dealerships: [
      { dealerId: "dealer-one", dealerName: "Dealer One", role: "owner" },
    ] });
    const first = await call("/dealers/dealer-one/api/staff/test-scope", { ...staff, method: "POST", origin: `https://${central}` });
    assert.deepEqual(await first.json(), { dealer: "dealer-one", role: "owner", origin: "https://dealer-one.example.test" });
    for (const id of ["dealer-two", "dealer-other", "website-only", "archived-dealer"]) {
      assert.equal((await call(`/dealers/${id}/api/staff/test-scope`, staff)).status, 404);
      assert.equal(sharedStaffWorkspaceUrl(id), null);
    }
    assert.equal((await call("/dealers/dealer-one/api/staff/test-scope", { ...staff, origin: "https://dealer-one.example.test" })).status, 403);
    assert.equal((await call("/api/staff/access", staff)).status, 404);
    assert.equal((await call("/api/platform/dealers", staff)).status, 404);
    assert.equal((await call("/dealers/dealer-one/api/staff/push", staff)).status, 404);
    assert.deepEqual(await (await call("/dealers/dealer-one/api/enquiries/availability", staff)).json(), { dealer: "dealer-one" });
    assert.deepEqual(await (await call("/dealers/dealer-one/api/ai/status", staff)).json(), { dealer: "dealer-one" });
    assert.deepEqual(await (await call("/dealers/dealer-one/api/ai/assist", { ...staff, method: "POST", origin: `https://${central}` })).json(), { dealer: "dealer-one" });
    assert.deepEqual(await (await call("/portal", { host: "dealer-one.example.test" })).json(), { legacy: true });
    assert.deepEqual(await (await call("/dealers/dealer-one/portal", staff)).json(), { legacy: false, canonical: "https://dealer-one.example.test" });
    assert.equal((await call("/dealers/dealer-other/portal", staff)).status, 404);
    assert.deepEqual(await (await call("/dealers/dealer-one/portal", { user: "user_other" })).json(), { legacy: false });
    const sharedOwnerId = (await engine.query<{ id: string }>("SELECT id FROM portal_users WHERE dealer_id='dealer-one' AND auth_user_id='user_fixture'")).rows[0].id;
    const legacyOwnerId = (await engine.query<{ id: string }>("SELECT id FROM portal_users WHERE dealer_id='dealer-one' AND auth_user_id='user_legacy'")).rows[0].id;
    for (const id of [sharedOwnerId, legacyOwnerId]) {
      const update = await call(`/dealers/dealer-one/api/staff/team/${id}`, { ...staff, method: "PATCH", body: { active: false } });
      assert.equal(update.status, 409);
      assert.match(await update.text(), /one active owner for this sign-in/);
    }
    assert.equal((await call("/dealers/dealer-one/api/staff/team", { ...staff, method: "POST", body: { role: "owner", email: "new@example.test" } })).status, 409);
    await engine.exec("UPDATE portal_users SET disabled_at=now() WHERE dealer_id='dealer-one' AND auth_user_id='user_fixture'");
    assert.equal((await call("/dealers/dealer-one/api/staff/test-scope", staff)).status, 403);
    await engine.exec("UPDATE portal_users SET disabled_at=NULL WHERE dealer_id='dealer-one' AND auth_user_id='user_fixture'");

    await t.test("a fresh host-bound invitation can add the new verified identity with the existing role", async () => {
      let sentText = "";
      const transport = (async (_url, init) => {
        sentText = JSON.parse(String(init?.body)).text;
        return Response.json({ id: "fixture-mail" });
      }) as typeof fetch;
      const issuer = { id: "user_fixture", kind: "staff" as const };
      await assert.rejects(issueAccountInvitation("dealer-one", "owner@example.test", "salesperson", issuer, { transport }), { status: 409 });
      await issueAccountInvitation("dealer-one", "owner@example.test", "owner", issuer, { transport });
      const token = sentText.match(/join#(shared_[a-f0-9]{64})/)?.[1] ?? "";
      assert.match(sentText, /https:\/\/staff\.example\.test\/join#/);
      await assert.rejects(readAccountInvitation(token, "dealer-one.example.test"), { status: 403 });
      await assert.rejects(acceptAccountInvitation(token, central, { id: "user_central", name: "Fictional Owner", emails: ["other@example.test"] }), { status: 403 });
      const accepted = await acceptAccountInvitation(token, central, { id: "user_central", name: "Fictional Owner", emails: ["owner@example.test"] });
      assert.equal(accepted.portalUrl, `https://${central}/dealers/dealer-one/portal`);
      assert.equal((await call("/dealers/dealer-one/api/staff/test-scope", { user: "user_central" })).status, 200);
      assert.equal((await call("/dealers/dealer-two/api/staff/test-scope", { user: "user_central" })).status, 404);
      process.env.STAFF_PORTAL_PILOT_DEALER_ID = "dealer-two";
      await assert.rejects(readAccountInvitation(token, central), { status: 403 });
      const second = await call("/dealers/dealer-two/api/staff/test-scope", staff);
      assert.deepEqual(await second.json(), { dealer: "dealer-two", role: "accounts" });
      assert.equal((await call("/dealers/dealer-one/api/staff/test-scope", staff)).status, 404);
      process.env.STAFF_PORTAL_PILOT_DEALER_ID = "dealer-one";
    });
    await t.test("another dealership continues to issue invitations for its own sign-in", async () => {
      let sentText = "";
      const transport = (async (_url, init) => {
        sentText = JSON.parse(String(init?.body)).text;
        return Response.json({ id: "fixture-legacy-mail" });
      }) as typeof fetch;
      await issueAccountInvitation("dealer-other", "legacy@example.test", "salesperson",
        { id: "user_other", kind: "staff" }, { transport });
      const token = sentText.match(/join#([a-f0-9]{64})/)?.[1] ?? "";
      assert.match(sentText, /https:\/\/dealer-other\.example\.test\/join#/);
      await assert.rejects(readAccountInvitation(token, central), { status: 403 });
      const accepted = await acceptAccountInvitation(token, "dealer-other.example.test",
        { id: "user_other_legacy", name: "Legacy Staff", emails: ["legacy@example.test"] });
      assert.equal(accepted.portalUrl, "https://dealer-other.example.test/portal");
    });
    await t.test("a planned Full Portal owner can accept centrally before workspace access opens", async () => {
      process.env.STAFF_PORTAL_PILOT_DEALER_ID = "planned-dealer";
      let sentText = "";
      const transport = (async (_url, init) => {
        sentText = JSON.parse(String(init?.body)).text;
        return Response.json({ id: "fixture-planned-mail" });
      }) as typeof fetch;
      await issueAccountInvitation("planned-dealer", "planned@example.test", "owner",
        { id: "user_platform_fixture", kind: "platform" }, { transport });
      const token = sentText.match(/join#(shared_[a-f0-9]{64})/)?.[1] ?? "";
      const result = await acceptAccountInvitation(token, central,
        { id: "user_planned_owner", name: "Planned Owner", emails: ["planned@example.test"] });
      assert.equal(result.portalUrl, null);
      assert.deepEqual(await (await call("/api/staff-portal/memberships", { user: "user_planned_owner" })).json(), { dealerships: [] });
      assert.equal((await call("/dealers/planned-dealer/api/staff/test-scope", { user: "user_planned_owner" })).status, 403);
      const saved = (await engine.query("SELECT role, shared_staff_identity FROM portal_users WHERE dealer_id='planned-dealer' AND auth_user_id='user_planned_owner'")).rows[0];
      assert.deepEqual(saved, { role: "owner", shared_staff_identity: true });
      await engine.exec("UPDATE dealerships SET status='active' WHERE id='planned-dealer'");
      assert.equal((await call("/dealers/planned-dealer/api/staff/test-scope", { user: "user_planned_owner" })).status, 200);
    });
    await t.test("the shared host requires a valid configured pilot and the pilot must remain eligible", async () => {
      for (const id of ["website-only", "archived-dealer"]) {
        process.env.STAFF_PORTAL_PILOT_DEALER_ID = id;
        assert.deepEqual(await (await call("/api/staff-portal/memberships", staff)).json(), { dealerships: [] });
        assert.equal((await call(`/dealers/${id}/api/staff/test-scope`, staff)).status, 403);
      }
      delete process.env.STAFF_PORTAL_PILOT_DEALER_ID;
      assert.equal(sharedStaffWorkspaceUrl("dealer-one"), null);
      assert.deepEqual(await (await call("/portal")).json(), { legacy: true });
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
  }
});
