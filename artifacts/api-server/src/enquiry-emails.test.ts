import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, request } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  engine,
  dealershipsTable,
  dealerDomainsTable,
  enquiriesTable,
  vehiclesTable,
  portalUsersTable,
  enquiryEmailsTable,
  enquiryEventsTable,
} from "./test/tenant-test-db";
import { resolveTenant } from "./middlewares/tenant";
import { createEnquiryEmailRouter } from "./routes/enquiry-emails";
import { defaultEmailAppearance } from "@workspace/vehicle-meta";
import type { PrivateDealerSettings } from "./lib/dealer-integrations-store";

process.env.MULTI_TENANT_ENABLED = "true";
test("enquiry emails: scoped previews, private photo attachments, exact concurrent retries, changed facts and uncertain provider replies", async () => {
  for (const name of (await readdir("../../lib/db/drizzle"))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + name, "utf8"));
  const cars = [randomUUID(), randomUUID()],
    enquiries = [randomUUID(), randomUUID()],
    photos = [randomUUID(), randomUUID()];
  for (const [index, dealer] of ["a", "b"].entries()) {
    await db.insert(dealershipsTable).values({
      id: dealer,
      name: dealer,
      status: "active",
      canonicalOrigin: `https://${dealer}.example.test`,
      stockPlatform: "autotrader",
      retailerId: dealer,
      sourceUrl: "https://www.autotrader.co.uk/example",
    });
    await db.insert(dealerDomainsTable).values({
      hostname: `${dealer}.example.test`,
      dealerId: dealer,
      verified: true,
      verificationToken: "fictional",
    });
    await db.insert(portalUsersTable).values({
      dealerId: dealer,
      authUserId: `user_${dealer}`,
      role: "owner",
    });
    await db.insert(vehiclesTable).values({
      id: cars[index],
      dealerId: dealer,
      source: "autotrader",
      advertId: dealer,
      title: `Car ${dealer}`,
      sourcePrice: 9000,
      mileage: 42000,
      plate: "AB19 XYZ",
      inventoryStatus: "available",
    });
    await db.insert(enquiriesTable).values({
      id: enquiries[index],
      dealerId: dealer,
      vehicleId: cars[index],
      vehicleTitle: `Car ${dealer}`,
      type: "viewing",
      customerName: `Customer ${dealer}`,
      email: `${dealer}@example.test`,
      message: "Please send the service book.",
      appointmentAt: new Date("2027-01-05T11:00:00Z"),
      appointmentStatus: "pending",
    });
    await db.execute(
      sql`INSERT INTO vehicle_service_photos(id,dealer_id,vehicle_id,jpeg,byte_size,width,height,uploaded_by) VALUES(${photos[index]}::uuid,${dealer},${cars[index]}::uuid,decode('ffd8ffd9','hex'),4,2,2,'fictional')`,
    );
  }
  await db
    .insert(portalUsersTable)
    .values({ dealerId: "a", authUserId: "accounts", role: "accounts" });
  await db
    .insert(dealerDomainsTable)
    .values({
      hostname: "www.a.example.test",
      dealerId: "a",
      verified: true,
      verificationToken: "fictional",
    });
  const config: PrivateDealerSettings = {
    version: 1,
    revision: 0,
    updatedAt: null,
    resend: {
      enabled: true,
      apiKey: "re_fictional_not_used",
      from: "sales@example.test",
      replyTo: "",
    },
    stripe: {
      enabled: false,
      mode: "test",
      publishableKey: "",
      secretKey: "",
      webhookSecret: "",
    },
    templates: {},
    appearance: { ...defaultEmailAppearance },
  };
  const sends: any[] = [];
  let failure: string | null = null;
  const app = express();
  app.use(express.json());
  app.use(resolveTenant);
  app.use(
    "/api",
    createEnquiryEmailRouter({
      settings: async () => config,
      send: async (_settings, body) => {
        sends.push(body);
        await new Promise((r) => setTimeout(r, 20));
        if (failure) throw new Error(failure);
        return "fictional-provider-id";
      },
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  async function call(
    path: string,
    body?: unknown,
    user = "user_a",
    host = "a",
    origin = "",
  ) {
    return new Promise<{ status: number; data: any }>((resolve) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: body ? "POST" : "GET",
          headers: {
            Host: `${host}.example.test`,
            "Content-Type": "application/json",
            ...(user ? { "x-test-user": user } : {}),
            ...(origin ? { Origin: origin } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              data: JSON.parse(Buffer.concat(chunks).toString()),
            }),
          );
        },
      );
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  const base = `/api/staff/enquiries/${enquiries[0]}`;
  const draft = {
    to: "a@example.test",
    subject: "Your car",
    message:
      "Hi, here is the service book. <script>literal text</script> {{unknown}}",
    includeVehicle: true,
    includeAppointment: true,
    photoIds: [photos[0]],
    expectedRevision: 0,
  };
  try {
    assert.equal(
      (await call(base + "/email-context", undefined, "")).status,
      401,
    );
    assert.equal(
      (await call(base + "/email-context", undefined, "accounts")).status,
      403,
    );
    assert.equal(
      (await call(`/api/staff/enquiries/${enquiries[1]}/email-context`)).status,
      404,
    );
    assert.equal(
      (await call(base + "/email-context", undefined, "user_a", "b")).status,
      403,
    );
    assert.equal(
      (
        await call(
          base + "/email-preview",
          draft,
          "user_a",
          "a",
          "https://evil.example.test",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(
          base + "/email-preview",
          draft,
          "user_a",
          "www.a",
          "https://www.a.example.test",
        )
      ).status,
      200,
    );
    const context = await call(base + "/email-context");
    assert.equal(context.status, 200);
    assert.equal(context.data.photos.length, 1);
    assert.equal(context.data.ready, true);
    assert.ok(!JSON.stringify(context.data).includes("re_fictional"));
    assert.equal(
      (await call(base + "/email-preview", { ...draft, photoIds: [photos[1]] }))
        .status,
      409,
    );
    assert.equal(
      (
        await call(base + "/email-preview", {
          ...draft,
          photoIds: [photos[0], photos[0]],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(base + "/email-preview", {
          ...draft,
          subject: "Bad\nSubject",
        })
      ).status,
      400,
    );
    let preview = await call(base + "/email-preview", draft);
    assert.equal(preview.status, 200);
    assert.equal(sends.length, 0);
    assert.match(preview.data.text, /Awaiting showroom approval/);
    assert.match(preview.data.text, /£9,000/);
    assert.match(preview.data.text, /AB19 XYZ/);
    assert.ok(!JSON.stringify(preview.data).includes("ffd8"));
    const payload = {
      ...draft,
      requestId: randomUUID(),
      previewHash: preview.data.previewHash,
    };
    const pair = await Promise.all([
      call(base + "/email", payload),
      call(base + "/email", payload),
    ]);
    assert.deepEqual(pair.map((r) => r.status).sort(), [200, 201]);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].attachments.length, 1);
    assert.equal(
      Buffer.from(sends[0].attachments[0].content, "base64").toString("hex"),
      "ffd8ffd9",
    );
    assert.match(sends[0].html, /&lt;script&gt;/);
    assert.ok(!sends[0].html.includes("<script>"));
    assert.ok(sends[0].text.includes("{{unknown}}"));
    const retry = await call(base + "/email", payload);
    assert.equal(retry.data.replayed, true);
    assert.equal(retry.data.delivery.status, "sent");
    assert.equal(sends.length, 1);
    assert.equal(
      (await call(base + "/email", { ...payload, message: "Changed" })).status,
      409,
    );
    assert.equal((await db.select().from(enquiryEmailsTable)).length, 1);
    assert.equal((await db.select().from(enquiryEventsTable)).length, 1);
    await db
      .update(vehiclesTable)
      .set({ sourcePrice: 8750 })
      .where(eq(vehiclesTable.id, cars[0]));
    assert.equal(
      (await call(base + "/email", { ...payload, requestId: randomUUID() }))
        .status,
      409,
    );
    assert.equal(sends.length, 1);
    preview = await call(base + "/email-preview", draft);
    assert.match(preview.data.text, /£8,750/);
    await db.execute(
      sql`DELETE FROM vehicle_service_photos WHERE id=${photos[0]}::uuid`,
    );
    assert.equal(
      (
        await call(base + "/email", {
          ...payload,
          requestId: randomUUID(),
          previewHash: preview.data.previewHash,
        })
      ).status,
      409,
    );
    assert.equal(sends.length, 1);
    const noPhotos = { ...draft, photoIds: [] };
    preview = await call(base + "/email-preview", noPhotos);
    failure = "Email provider connection failed.";
    const uncertain = {
      ...noPhotos,
      requestId: randomUUID(),
      previewHash: preview.data.previewHash,
    };
    const unknown = await call(base + "/email", uncertain);
    assert.equal(unknown.data.delivery.status, "unknown");
    await call(base + "/email", uncertain);
    assert.equal(
      sends.length,
      2,
      "uncertain delivery must never automatically resend",
    );
    failure = "Email provider returned HTTP 422.";
    const rejected = await call(base + "/email", {
      ...uncertain,
      requestId: randomUUID(),
    });
    assert.equal(rejected.data.delivery.status, "failed");
    config.resend.enabled = false;
    assert.equal(
      (await call(base + "/email", { ...uncertain, requestId: randomUUID() }))
        .status,
      503,
    );
    assert.equal(sends.length, 3);
    assert.equal(
      (await call(base + "/email", payload)).data.delivery.status,
      "sent",
      "saved retry works after configuration is disabled",
    );
    config.resend.enabled = true;
    await db
      .update(enquiriesTable)
      .set({ workspaceRevision: 1 })
      .where(eq(enquiriesTable.id, enquiries[0]));
    assert.equal((await call(base + "/email-preview", noPhotos)).status, 409);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
  }
});
