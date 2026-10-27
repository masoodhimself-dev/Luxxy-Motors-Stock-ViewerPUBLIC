import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { createServer, request } from "node:http";
import express from "express";
import { engine, pool } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import { whatsappConfirmationRouter } from "./lib/whatsapp-confirmation";
process.env.MULTI_TENANT_ENABLED = "true";
test("manual WhatsApp confirmation keeps the number, exact message and canonical customer history tenant scoped", async () => {
  globalThis.fetch = async () => {
    throw new Error("No external WhatsApp or provider traffic permitted.");
  };
  for (const file of (await readdir("../../lib/db/drizzle"))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + file, "utf8"));
  const source = randomUUID(),
    canonical = randomUUID(),
    foreign = randomUUID();
  for (const dealer of ["wa-a", "wa-b"])
    await pool.query(
      "INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Fictional Dealer','active',$2,'autotrader','fictional','https://www.autotrader.co.uk/fictional')",
      [dealer, `https://${dealer}.example.test`],
    );
  for (const [id, dealer] of [
    [source, "wa-a"],
    [canonical, "wa-a"],
    [foreign, "wa-b"],
  ])
    await pool.query(
      "INSERT INTO enquiries(id,dealer_id,type,status,customer_name,email,phone,message) VALUES($1::uuid,$2,'general','new','Fictional Customer','buyer@example.test','07700 900123','Original enquiry')",
      [id, dealer],
    );
  await pool.query(
    "UPDATE enquiries SET merged_into_id=$2::uuid WHERE id=$1::uuid",
    [source, canonical],
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.staff = {
      authUserId: "fictional-owner",
      name: "Fictional Owner",
      email: "owner@example.test",
      role: "owner",
    };
    runWithTenant(
      {
        dealerId: req.get("x-test-dealer") || "wa-a",
        canonicalOrigin: "https://wa-a.example.test",
        platform: "autotrader",
        retailerId: "fictional",
        sourceUrl: "https://www.autotrader.co.uk/fictional",
      },
      next,
    );
  });
  app.use("/api/staff/whatsapp", whatsappConfirmationRouter());
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const call = (path: string, body?: unknown, dealer = "wa-a") =>
    new Promise<{ status: number; data: any }>((resolve, reject) => {
      const r = request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/staff/whatsapp" + path,
          method: body ? "POST" : "GET",
          headers: {
            "content-type": "application/json",
            "x-test-dealer": dealer,
          },
        },
        (res) => {
          let out = "";
          res.on("data", (c) => (out += c));
          res.on("end", () =>
            resolve({ status: res.statusCode!, data: JSON.parse(out) }),
          );
        },
      );
      r.on("error", reject);
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  try {
    const lookup = await call("/enquiries?id=" + source);
    assert.equal(lookup.status, 200);
    assert.equal(lookup.data.enquiries[0].id, canonical);
    assert.equal(lookup.data.enquiries[0].requestedEnquiryId, source);
    assert.equal(lookup.data.enquiries[0].phone, "07700 900123");
    assert.deepEqual(
      (await call("/enquiries?id=" + foreign)).data.enquiries,
      [],
    );
    const body = {
      requestId: randomUUID(),
      enquiryId: source,
      phone: lookup.data.enquiries[0].phone,
      message: "Your test drive is booked. Please bring your driving licence.",
      confirmed: true,
    };
    const saved = await call("/confirm-whatsapp", body);
    assert.equal(saved.status, 201);
    assert.equal(saved.data.enquiryId, canonical);
    const event = (
      await pool.query("SELECT * FROM enquiry_events WHERE id=$1::uuid", [
        body.requestId,
      ])
    ).rows[0]!;
    assert.equal(event.enquiry_id, canonical);
    assert.equal(event.dealer_id, "wa-a");
    assert.equal(event.detail.message, body.message);
    assert.equal(event.detail.recipientPhone, "+447700900123");
    assert.equal(event.detail.deliveryVerified, false);
    assert.match(event.detail.note, /delivery not verified/);
    assert.equal((await call("/confirm-whatsapp", body)).data.replayed, true);
    assert.equal(
      Number(
        (
          await pool.query(
            "SELECT count(*) FROM enquiry_events WHERE id=$1::uuid",
            [body.requestId],
          )
        ).rows[0]!.count,
      ),
      1,
    );
    assert.equal(
      (
        await call("/confirm-whatsapp", {
          ...body,
          message: "Different message",
        })
      ).status,
      409,
    );
    assert.equal((await call("/confirm-whatsapp", body, "wa-b")).status, 409);
    assert.equal(
      (
        await call("/confirm-whatsapp", {
          ...body,
          requestId: randomUUID(),
          enquiryId: foreign,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call("/confirm-whatsapp", {
          ...body,
          requestId: randomUUID(),
          confirmed: false,
        })
      ).status,
      400,
    );
    const customer = (
      await pool.query("SELECT phone,status FROM enquiries WHERE id=$1::uuid", [
        canonical,
      ])
    ).rows[0]!;
    assert.equal(customer.phone, "07700 900123");
    assert.equal(customer.status, "contacted");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
  }
});
