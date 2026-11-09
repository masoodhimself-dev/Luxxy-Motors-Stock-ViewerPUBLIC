import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import express from "express";
import pino from "pino";
import { engine, pool } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import { staffWorkspaceToolsRouter } from "./routes/staff-workspace-tools";
import {
  ReplyPresenceStore,
  searchWorkspace,
  workspaceReport,
  workspaceReportCsv,
  reportRange,
} from "./lib/staff-workspace-tools";

process.env.MULTI_TENANT_ENABLED = "true";
const dealer = "workspace-fixture-a",
  other = "workspace-fixture-b",
  at = "2026-11-06T12:00:00Z";
test("staff workspace tools stay tenant scoped and preserve business records", async (t) => {
  for (const name of (await readdir("../../lib/db/drizzle"))
    .filter((n) => /^\d+.*\.sql$/.test(n))
    .sort())
    await engine.exec(await readFile(`../../lib/db/drizzle/${name}`, "utf8"));
  for (const id of [dealer, other])
    await pool.query(
      "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'autotrader','fixture','https://example.test/fixture')",
      [id, `https://${id}.example.test`],
    );
  const car = randomUUID(),
    enquiry = randomUUID(),
    privateCar = randomUUID(),
    privateEnquiry = randomUUID();
  for (const [id, d] of [
    [car, dealer],
    [privateCar, other],
  ])
    await pool.query(
      "INSERT INTO vehicles(id,dealer_id,source,advert_id,title,make,model,plate) VALUES($1::uuid,$2,'fixture',$1::text,'Toyota Land Cruiser','Toyota','Land Cruiser','SB09YAO')",
      [id, d],
    );
  for (const [id, d] of [
    [enquiry, dealer],
    [privateEnquiry, other],
  ])
    await pool.query(
      "INSERT INTO enquiries(id,dealer_id,customer_name,message,email,vehicle_title,vehicle_registration,created_at,type) VALUES($1,$2,'Fixture Buyer','Secret message not in search','fixture@example.test','Toyota Land Cruiser','SB09YAO',$3,'general')",
      [id, d, at],
    );
  const draft = {
    id: randomUUID(),
    customer: "Fixture Buyer",
    email: "fixture@example.test",
    phone: "07700900123",
    address: "Fixture address",
    vehicleId: car,
    vehicle: "Toyota Land Cruiser",
    registration: "SB09YAO",
    price: "1000",
    partExchange: false,
    pxRegistration: "",
    pxDescription: "",
    pxValue: "",
    deposit: "",
    paymentMethod: "bank",
    notes: "",
    collection: "",
    preparation: false,
    documents: false,
    handover: false,
  };
  const sale = (id: string, payments: any[] = []) => ({
    id,
    reference: `SALE-${id.slice(0, 5)}`,
    revision: 1,
    draft: { ...draft, id },
    payments,
    documents: [],
    events: [],
    createdAt: at,
    updatedAt: at,
    requests: {},
  });
  const saleId = randomUUID(),
    otherSaleId = randomUUID();
  const payment = (id: string, amount: number, status = "confirmed") => ({
    id,
    date: "2026-11-06",
    status,
    signedAmountPence: amount,
    amountPence: Math.abs(amount),
    kind: amount < 0 ? "refund" : "deposit",
  });
  const current = {
    ...sale(saleId, [
      payment("received", 50000),
      payment("refund", -10000),
      payment("pending", 10000, "pending"),
    ]),
    documents: [{ type: "invoice", number: "INV-FIXTURE-123" }],
  };
  for (const [id, d, state] of [
    [saleId, dealer, current],
    [otherSaleId, other, sale(otherSaleId, [payment("private", 999999)])],
  ] as const)
    await pool.query(
      "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)",
      [id, d, state.reference, JSON.stringify(state)],
    );
  await t.test(
    "search matches cars, customers and invoice numbers without leaking another dealer or message bodies",
    async () => {
      const found = await searchWorkspace(pool, dealer, "Toyota", true);
      assert.equal(found.results.length, 3);
      assert.ok(!JSON.stringify(found).includes(privateCar));
      assert.ok(!JSON.stringify(found).includes("Secret message"));
      const invoice = await searchWorkspace(pool, dealer, "INV-FIXTURE", false);
      assert.equal(invoice.results[0].id, saleId);
      assert.equal(invoice.results[0].kind, "sale");
      const accounts = await searchWorkspace(pool, dealer, "Fixture", false);
      assert.ok(accounts.results.every((r) => r.kind !== "customer"));
      assert.equal(
        (
          await searchWorkspace(pool, dealer, "%", true).catch(() => ({
            results: [],
          }))
        ).results.length,
        0,
      );
      await assert.rejects(
        searchWorkspace(pool, dealer, "a", true),
        /between 2/,
      );
    },
  );
  await t.test(
    "shared expiring presence supports explicit take-over and protects the new owner from old releases",
    async () => {
      let time = new Date(at);
      const store = new ReplyPresenceStore(pool, () => time),
        one = randomUUID(),
        two = randomUUID(),
        staffA = { id: "staff-a", name: "A Staff" },
        staffB = { id: "staff-b", name: "B Staff" };
      assert.equal(
        (await store.claim(dealer, enquiry, staffA, one)).claimed,
        true,
      );
      assert.equal(
        (await store.claim(dealer, enquiry, staffB, two)).claimed,
        false,
      );
      assert.equal(
        (await store.claim(dealer, enquiry, staffB, two, true)).claimed,
        true,
      );
      await store.release(dealer, enquiry, staffA.id, one);
      assert.equal((await store.read(dealer, enquiry))?.staff_id, staffB.id);
      await assert.rejects(store.read(other, enquiry), /not found/);
      await assert.rejects(
        store.claim(other, enquiry, staffA, one),
        /not found/,
      );
      time = new Date(Date.parse(at) + 91_000);
      assert.equal(await store.read(dealer, enquiry), null);
      assert.equal(
        (await store.claim(dealer, enquiry, staffA, one)).claimed,
        true,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT status,workspace_revision FROM enquiries WHERE id=$1",
            [enquiry],
          )
        ).rows[0].workspace_revision,
        0,
      );
    },
  );
  await t.test(
    "owner report uses confirmed money only, excludes other dealers and exports numeric values",
    async () => {
      const report = await workspaceReport(
        pool,
        dealer,
        "2026-11-01",
        "2026-11-30",
      );
      assert.equal(report.enquiries, 1);
      assert.equal(report.receivedPence, 50000);
      assert.equal(report.refundsPence, 10000);
      assert.equal(report.netReceivedPence, 40000);
      assert.equal(report.currentOutstandingPence, 60000);
      const csv = workspaceReportCsv(report);
      assert.ok(csv.includes('"40000"'));
      assert.ok(!csv.includes("Fixture Buyer"));
      assert.throws(
        () => reportRange("2026-02-30", "2026-03-01"),
        /valid reporting/,
      );
      assert.throws(() => reportRange("2020-01-01", "2026-01-01"), /one year/);
    },
  );
  await t.test(
    "returned credit is counted once and external refunds never invent a new debt",
    async () => {
      const states = [
        {
          ...sale(randomUUID(), [payment("released", 50000)]),
          lifecycle: { status: "released" },
        },
        {
          ...sale(randomUUID(), [payment("original", 100000)]),
          returnReplacement: { direction: "returned" },
          lifecycle: { status: "returned" },
        },
        {
          ...sale(randomUUID(), [
            payment("return-paid", 100000),
            payment("return-refund", -20000),
          ]),
          draft: { ...draft, returnCreditPence: 100000 },
          standaloneReturn: { id: "fixture-return" },
          lifecycle: { status: "returned" },
        },
        {
          ...sale(randomUUID(), [
            payment("completed", 100000),
            payment("external-refund", -10000),
          ]),
          completedAt: at,
        },
        {
          ...sale(randomUUID()),
          draft: {
            ...draft,
            price: "500",
            creditEntries: [{ id: "transfer", signedAmountPence: 100000 }],
          },
          returnReplacement: { direction: "replacement" },
        },
      ];
      for (const state of states)
        await pool.query(
          "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)",
          [state.id, dealer, state.reference, JSON.stringify(state)],
        );
      const report = await workspaceReport(
        pool,
        dealer,
        "2026-11-01",
        "2026-11-30",
      );
      assert.equal(report.currentOutstandingPence, 60000);
      assert.equal(report.currentCustomerCreditPence, 130000);
      assert.equal(report.unreviewedBalances, 1);
    },
  );
  await t.test(
    "HTTP routes require owner reports, enforce no-store and reject cross-origin presence writes",
    async () => {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.log = pino({ level: "silent" });
        const role = req.get("x-test-role");
        if (role)
          req.staff = {
            authUserId: "fixture-staff",
            name: "Fixture Staff",
            email: null,
            role: role as any,
          };
        runWithTenant(
          {
            dealerId: dealer,
            canonicalOrigin: `https://${dealer}.example.test`,
            platform: "autotrader",
            retailerId: "fixture",
            sourceUrl: "https://example.test/fixture",
          },
          next,
        );
      });
      app.use("/api", staffWorkspaceToolsRouter(pool));
      const server = app.listen(0, "127.0.0.1");
      await new Promise<void>((r) => server.once("listening", r));
      const address = server.address() as { port: number };
      const base = `http://127.0.0.1:${address.port}/api/staff/workspace`;
      try {
        const denied = await fetch(
          `${base}/report?from=2026-11-01&to=2026-11-30`,
          { headers: { "x-test-role": "salesperson" } },
        );
        assert.equal(denied.status, 403);
        const ok = await fetch(`${base}/report?from=2026-11-01&to=2026-11-30`, {
          headers: { "x-test-role": "owner" },
        });
        assert.equal(ok.status, 200);
        assert.match(ok.headers.get("cache-control")!, /no-store/);
        const cross = await fetch(`${base}/presence/${enquiry}`, {
          method: "POST",
          headers: {
            "x-test-role": "salesperson",
            "Content-Type": "application/json",
            Origin: "https://other.example.test",
          },
          body: JSON.stringify({ session: randomUUID() }),
        });
        assert.equal(cross.status, 403);
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        );
      }
    },
  );
  await engine.close();
});
