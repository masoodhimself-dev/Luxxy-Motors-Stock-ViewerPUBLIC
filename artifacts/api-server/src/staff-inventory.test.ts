import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, request } from "node:http";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  db,
  engine,
  dealershipsTable,
  dealerDomainsTable,
  vehiclesTable,
  vehicleImagesTable,
  portalUsersTable,
} from "./test/tenant-test-db";
import { resolveTenant } from "./middlewares/tenant";
import inventory from "./routes/staff-inventory";
import { serviceBookJpeg } from "./lib/service-book-jpeg";
process.env.MULTI_TENANT_ENABLED = "true";
const jpeg = Buffer.from([
  255, 216, 255, 225, 0, 8, 69, 88, 73, 70, 0, 0, 255, 192, 0, 11, 8, 0, 2, 0,
  2, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 3, 255, 217,
]).toString("base64");
test("private inventory: two-dealer permissions, limited QR upload, exact retries, revocation, expiry and preparation revisions", async () => {
  for (const f of (await readdir("../../lib/db/drizzle"))
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort())
    await engine.exec(await readFile(join("../../lib/db/drizzle", f), "utf8"));
  const carA = randomUUID(),
    carB = randomUUID(),
    memberB = randomUUID();
  for (const d of ["a", "b"]) {
    await db.insert(dealershipsTable).values({
      id: d,
      name: d,
      status: "active",
      canonicalOrigin: `https://${d}.example.test`,
      stockPlatform: "autotrader",
      retailerId: d,
      sourceUrl: "https://www.autotrader.co.uk/example",
    });
    await db.insert(dealerDomainsTable).values({
      hostname: `${d}.example.test`,
      dealerId: d,
      verified: true,
      verificationToken: "fictional",
    });
    await db.insert(portalUsersTable).values({
      ...(d === "b" ? { id: memberB } : {}),
      dealerId: d,
      authUserId: `user_${d}`,
      role: "owner",
      email: `${d}@example.test`,
    });
    await db.insert(vehiclesTable).values({
      id: d === "a" ? carA : carB,
      dealerId: d,
      source: "autotrader",
      advertId: d,
      title: `Car ${d}`,
      sourcePrice: 9000,
      ...(d === "a" ? { year: 2019, mileage: 52000, fuel: "Petrol", transmission: "Manual", rawSourceData: { privateSource: "PRIVATE-SOURCE-BULK".repeat(1000) } } : {}),
    });
  }
  await db
    .insert(portalUsersTable)
    .values({ dealerId: "a", authUserId: "user_accounts", role: "accounts" });
  await db.insert(vehicleImagesTable).values([
    { vehicleId: carA, sourceUrl: "https://images.example.test/front.jpg", caption: "Front", sortOrder: 1 },
    { vehicleId: carA, sourceUrl: "https://images.example.test/old.jpg", caption: "Front", isActive: false },
    { vehicleId: carB, sourceUrl: "https://images.example.test/other-dealer.jpg", caption: "Front" },
  ]);
  const app = express();
  app.use(express.json({ limit: "2200kb" }));
  app.use((req, _res, next) => {
    req.log = { warn: () => {} } as any;
    next();
  });
  app.use(resolveTenant);
  app.use("/api", inventory);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  async function call(
    path: string,
    {
      host = "a",
      user = "user_a",
      token = "",
      method = "GET",
      body = undefined as unknown,
    } = {},
  ) {
    return new Promise<{ status: number; data: any }>((resolve) => {
      const req = request(
        {
          host: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            Host: host + ".example.test",
            "Content-Type": "application/json",
            ...(user ? { "x-test-user": user } : {}),
            ...(token ? { "x-service-upload-token": token } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString();
            let data;
            try {
              data = JSON.parse(raw);
            } catch {
              data = raw;
            }
            resolve({ status: res.statusCode!, data });
          });
        },
      );
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  try {
    assert.equal(
      (await call("/api/staff/inventory", { user: "" })).status,
      401,
    );
    assert.equal(
      (await call("/api/staff/inventory", { host: "b" })).status,
      403,
    );
    const listed = (await call("/api/staff/inventory")).data;
    assert.equal(listed.cars.length, 1);
    const identifyingFacts = (car: Record<string, unknown>) => ({ year: car.year, mileage: car.mileage, fuel: car.fuel, transmission: car.transmission });
    assert.deepEqual(identifyingFacts(listed.cars[0]), { year: 2019, mileage: 52000, fuel: "Petrol", transmission: "Manual" });
    const ownDetail = (await call(`/api/staff/inventory/${carA}`)).data;
    assert.deepEqual(ownDetail.vehiclePhotos, [{ url: "https://images.example.test/front.jpg", caption: "Front" }]);
    assert.deepEqual(identifyingFacts(ownDetail.car), identifyingFacts(listed.cars[0]));
    assert.ok(!JSON.stringify({ listed, ownDetail }).includes("PRIVATE-SOURCE-BULK"));
    assert.equal((await call(`/api/staff/inventory/${carB}`)).status, 404);
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/upload-session`, {
          user: "user_accounts",
          method: "POST",
        })
      ).status,
      403,
    );
    const grant = await call(`/api/staff/inventory/${carA}/upload-session`, {
      method: "POST",
    });
    assert.equal(grant.status, 201);
    const token = grant.data.url.split("#")[1];
    assert.equal(
      (await call("/api/service-book-upload", { host: "b", user: "", token }))
        .status,
      410,
    );
    assert.equal(
      (await call("/api/service-book-upload", { user: "", token })).data
        .remaining,
      3,
    );
    const body = { requestId: randomUUID(), photos: [jpeg, jpeg] };
    const results = await Promise.all([
      call("/api/service-book-upload", {
        user: "",
        token,
        method: "POST",
        body,
      }),
      call("/api/service-book-upload", {
        user: "",
        token,
        method: "POST",
        body,
      }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
    assert.deepEqual(results[0].data.uploaded, results[1].data.uploaded);
    let detail = (await call(`/api/staff/inventory/${carA}`)).data;
    assert.equal(detail.photos.length, 2);
    assert.equal(
      (
        await call(
          `/api/staff/inventory/${carA}/photos/${detail.photos[0].id}`,
          { user: "" },
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await call(
          `/api/staff/inventory/${carA}/photos/${detail.photos[0].id}`,
          { host: "b", user: "user_b" },
        )
      ).status,
      404,
    );
    const next = await call(`/api/staff/inventory/${carA}/upload-session`, {
        method: "POST",
      }),
      nextToken = next.data.url.split("#")[1];
    assert.equal(
      (
        await call("/api/service-book-upload", {
          user: "",
          token: nextToken,
          method: "POST",
          body: { requestId: randomUUID(), photos: [jpeg, jpeg] },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call("/api/service-book-upload", {
          user: "",
          token: nextToken,
          method: "POST",
          body: { requestId: randomUUID(), photos: [jpeg] },
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/upload-session`, {
          method: "POST",
        })
      ).status,
      409,
    );
    await call(`/api/staff/inventory/${carA}/photos/${detail.photos[0].id}`, {
      method: "DELETE",
    });
    const revoked = await call(`/api/staff/inventory/${carA}/upload-session`, {
      method: "POST",
    });
    await call(
      `/api/staff/inventory/${carA}/upload-session/${revoked.data.id}`,
      { method: "DELETE" },
    );
    assert.equal(
      (
        await call("/api/service-book-upload", {
          user: "",
          token: revoked.data.url.split("#")[1],
        })
      ).status,
      410,
    );
    const expired = await call(`/api/staff/inventory/${carA}/upload-session`, {
      method: "POST",
    });
    await engine.exec(
      `UPDATE vehicle_service_upload_sessions SET expires_at=now()-interval '1 minute' WHERE id='${expired.data.id}'`,
    );
    assert.equal(
      (
        await call("/api/service-book-upload", {
          user: "",
          token: expired.data.url.split("#")[1],
        })
      ).status,
      410,
    );
    const prep = {
      revision: 0,
      tasks: {
        cleaning: "done",
        inspection: "pending",
        mot: "not_required",
        servicing: "pending",
      },
      assignedToId: null,
      dueDate: "2027-01-01",
      notes: "Private preparation",
    };
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/preparation`, {
          method: "PUT",
          body: { ...prep, assignedToId: memberB },
        })
      ).status,
      400,
    );
    const revisions = await Promise.all([
      call(`/api/staff/inventory/${carA}/preparation`, {
        method: "PUT",
        body: prep,
      }),
      call(`/api/staff/inventory/${carA}/preparation`, {
        method: "PUT",
        body: prep,
      }),
    ]);
    assert.deepEqual(revisions.map((r) => r.status).sort(), [200, 409]);
    await engine.exec(
      `UPDATE vehicles SET source_price=9500 WHERE id='${carA}'`,
    );
    detail = (await call(`/api/staff/inventory/${carA}`)).data;
    assert.equal(detail.photos.length, 2);
    assert.equal(detail.preparation.notes, "Private preparation");
    assert.equal(detail.car.price, 9500);
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/plate`, {
          method: "PUT",
          body: { plate: "ab12 cde", expectedPlate: null },
        })
      ).status,
      200,
    );
    assert.equal(
      (await call(`/api/staff/inventory/${carA}`)).data.car.plate,
      "AB12CDE",
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/plate`, {
          method: "PUT",
          body: { plate: "ZZ99ZZZ", expectedPlate: null },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/plate`, {
          host: "b",
          user: "user_b",
          method: "PUT",
          body: { plate: "ZZ99ZZZ", expectedPlate: null },
        })
      ).status,
      404,
    );
    const ag = await call(`/api/staff/inventory/${carA}/upload-session`, {
      method: "POST",
      body: { category: "pre_accident" },
    });
    assert.equal(ag.status, 201);
    const at = ag.data.url.split("#")[1];
    assert.equal(
      (await call("/api/service-book-upload", { token: at, user: "" })).data
        .category,
      "pre_accident",
    );
    assert.equal(
      (
        await call("/api/service-book-upload", {
          method: "POST",
          token: at,
          user: "",
          body: { requestId: randomUUID(), photos: [jpeg, jpeg, jpeg] },
        })
      ).status,
      201,
    );
    const photos2 = (await call(`/api/staff/inventory/${carA}`)).data.photos;
    assert.equal(
      photos2.filter((p: any) => p.category === "pre_accident").length,
      3,
    );
    assert.equal(
      photos2.filter((p: any) => p.category === "service_book").length,
      2,
    );
    await engine.exec(
      `UPDATE vehicles SET inventory_status='reserved' WHERE id='${carA}'`,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          host: "b",
          user: "user_b",
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (await call(`/api/staff/inventory/${carA}`)).data.car.inventory_status,
      "available",
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      409,
    );
    await engine.exec(
      `UPDATE vehicles SET inventory_status='reserved' WHERE id='${carA}'`,
    );
    const saleId = randomUUID();
    await engine.exec(
      `INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES('${saleId}','a','SALE-TEST',1,'${JSON.stringify({ id: saleId, revision: 1, draft: { vehicleId: carA }, lifecycle: { status: "reserved" }, payments: [{ status: "confirmed", signedAmountPence: 20000 }], events: [] })}'::jsonb)`,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      409,
    );
    assert.equal(
      (await call(`/api/staff/inventory/${carA}`)).data.car.inventory_status,
      "reserved",
    );
    await engine.exec(
      `UPDATE sale_workspace SET state=jsonb_set(state,'{payments}','[]'::jsonb) WHERE id='${saleId}'`,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await engine.query<any>(
          `SELECT state FROM sale_workspace WHERE id='${saleId}'`,
        )
      ).rows[0].state.lifecycle.status,
      "released",
    );
    const reservationLead = randomUUID();
    await engine.exec(
      `UPDATE vehicles SET inventory_status='reserved' WHERE id='${carA}'; INSERT INTO leads(id,dealer_id,vehicle_id,stage,source,customer_name) VALUES('${reservationLead}','a','${carA}','reserved','website_form','Fictional customer')`,
    );
    assert.equal(
      (
        await call(`/api/staff/inventory/${carA}/unreserve`, {
          method: "POST",
          body: { confirm: true },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await engine.query<any>(
          `SELECT stage FROM leads WHERE id='${reservationLead}'`,
        )
      ).rows[0].stage,
      "qualifying",
    );
    assert.equal(
      (
        await engine.query<any>(
          `SELECT payload FROM lead_events WHERE lead_id='${reservationLead}'`,
        )
      ).rows[0].payload.kind,
      "online_reservation_cancelled",
    );
    const clean = serviceBookJpeg(jpeg);
    assert.ok(!clean.bytes.includes(Buffer.from("EXIF")));
    assert.equal(clean.width, 2);
    assert.throws(() => serviceBookJpeg("not an image"));
    assert.throws(() =>
      serviceBookJpeg(Buffer.alloc(512001).toString("base64")),
    );
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await engine.close();
  }
});
