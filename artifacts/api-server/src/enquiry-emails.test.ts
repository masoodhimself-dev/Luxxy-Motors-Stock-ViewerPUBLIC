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
import { createStaffEmailRouter } from "./routes/staff-email";
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
  await db.insert(dealerDomainsTable).values({
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
    templates: { service_history: { subject: 'Service photos', body: 'Your photos are attached.', headline: 'Your service photos, {{customer_name}}' } },
    appearance: { ...defaultEmailAppearance },
  };
  const sends: any[] = [];
  const providerId = randomUUID();
  let providerEvent = "opened",
    providerHTTP = 200;
  const checks: any[] = [];
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
        return providerId;
      },
    }),
  );
  app.use(
    "/api",
    createStaffEmailRouter(
      async (url, options) => {
        checks.push({ url, options });
        return new Response(
          JSON.stringify({
            id: providerId,
            to: ["a@example.test"],
            last_event: providerEvent,
          }),
          {
            status: providerHTTP,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
      async () => config.resend,
    ),
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
    templateId: 'service_history',
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
    await engine.exec(
      `UPDATE vehicle_service_photos SET category='pre_accident' WHERE id='${photos[0]}'`,
    );
    const context = await call(base + "/email-context");
    assert.equal(context.status, 200);
    assert.equal(context.data.photos.length, 1);
    assert.equal(context.data.photos[0].category, "pre_accident");
    assert.equal(context.data.ready, true);
    assert.ok(
      context.data.templates.some((t: any) => t.id === "service_history"),
    );
    assert.ok(
      context.data.templates.every(
        (t: any) => !t.message.includes("{{customer_name}}"),
      ),
    );
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
    assert.match(preview.data.text, /Your service photos, Customer a/);
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
    assert.match(sends[0].html, /Your service photos, Customer a/);
    const emails = await call("/api/staff/email");
    assert.equal(emails.status, 200);
    assert.equal(emails.data.messages.length, 1);
    const messageKey = emails.data.messages[0].key;
    assert.equal(
      (
        await call(
          "/api/staff/email/message/" + encodeURIComponent(messageKey),
          undefined,
          "user_b",
          "b",
        )
      ).status,
      404,
    );
    const saved = await call(
      "/api/staff/email/message/" + encodeURIComponent(messageKey),
    );
    assert.match(saved.data.message.message, /£9,000/);
    const checked = await call(
      "/api/staff/email/message/" + encodeURIComponent(messageKey) + "/status",
      {},
    );
    assert.equal(checked.status, 200);
    assert.equal(checked.data.event, "opened");
    assert.equal(checks.length, 1);
    assert.equal(
      (
        await call(
          "/api/staff/email/message/" +
            encodeURIComponent(messageKey) +
            "/status",
          {},
        )
      ).data.cached,
      true,
    );
    assert.equal(checks.length, 1);
    assert.equal(
      (await call("/api/staff/email")).data.messages[0].last_event,
      "opened",
    );
    assert.equal(
      (await call("/api/staff/email", undefined, "user_b", "b")).data.messages
        .length,
      0,
    );
    assert.equal(sends[0].attachments.length, 1);
    assert.ok(sends[0].attachments[0].filename.includes("pre-accident"));
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
    const saleId = randomUUID(),
      invoiceId = randomUUID(),
      wrongInvoiceId = randomUUID();
    const invoice = {
      id: invoiceId,
      type: "invoice",
      title: "Full invoice",
      number: "TEST-INV-001",
      issuedAt: new Date().toISOString(),
      snapshot: {
        draft: {
          customer: "Customer a",
          email: "a@example.test",
          vehicleId: cars[0],
        },
      },
    };
    const saleState = {
      draft: {
        customer: "Customer a",
        email: "a@example.test",
        vehicleId: cars[0],
        sourceEnquiryId: enquiries[0],
      },
      documents: [
        invoice,
        {
          ...invoice,
          id: wrongInvoiceId,
          snapshot: {
            draft: { customer: "Other buyer", email: "other@example.test" },
          },
        },
      ],
      documentArchives: {
        [invoiceId]: {
          content: Buffer.from("EXACT-ORIGINAL-PDF").toString("base64"),
          sha256: "fixture",
        },
      },
      emailDeliveries: [
        {
          id: "invoice-mail-001",
          documentId: invoiceId,
          to: "a@example.test",
          providerId,
          status: "sent",
          attemptedAt: new Date().toISOString(),
        },
      ],
    };
    await engine.query(
      "INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,$3,1,$4::jsonb)",
      [saleId, "a", "SALE-001", JSON.stringify(saleState)],
    );
    const withInvoice = await call(base + "/email-context");
    assert.equal(withInvoice.data.invoices.length, 1);
    assert.equal(withInvoice.data.invoices[0].id, `${saleId}:${invoiceId}`);
    const invoicePreview = await call(base + "/email-preview", {
      ...noPhotos,
      documentIds: [`${saleId}:${invoiceId}`],
    });
    assert.equal(invoicePreview.status, 200);
    assert.equal(
      invoicePreview.data.attachments[0].filename,
      "TEST-INV-001.pdf",
    );
    failure = null;
    const invoiceEmail = await call(base + "/email", {
      ...noPhotos,
      documentIds: [`${saleId}:${invoiceId}`],
      requestId: randomUUID(),
      previewHash: invoicePreview.data.previewHash,
    });
    assert.equal(invoiceEmail.status, 201);
    assert.equal(
      Buffer.from(sends.at(-1).attachments[0].content, "base64").toString(),
      "EXACT-ORIGINAL-PDF",
    );
    assert.equal(
      (
        await call(base + "/email-preview", {
          ...noPhotos,
          documentIds: [`${saleId}:${wrongInvoiceId}`],
        })
      ).status,
      409,
    );
    assert.equal(
      (await call("/api/staff/email")).data.messages.filter(
        (m: any) => m.kind === "sale",
      ).length,
      1,
    );
    await db
      .update(enquiriesTable)
      .set({
        customerNotificationStatus: "sent",
        customerNotificationProviderId: providerId,
        customerNotificationAttemptedAt: new Date(),
      })
      .where(eq(enquiriesTable.id, enquiries[0]));
    assert.equal(
      (await call("/api/staff/email")).data.messages.filter(
        (m: any) => m.kind === "notification",
      ).length,
      1,
    );
    assert.equal(
      (
        await call(
          "/api/staff/email/message/" +
            encodeURIComponent("notification:" + enquiries[0]),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "/api/staff/email/message/" +
            encodeURIComponent(`sale:${saleId}:invoice-mail-001`),
          undefined,
          "user_b",
          "b",
        )
      ).status,
      404,
    );
    await engine.exec(
      "UPDATE email_delivery_checks SET checked_at='2020-01-01'",
    );
    providerEvent = "unexpected";
    assert.equal(
      (
        await call(
          "/api/staff/email/message/" +
            encodeURIComponent(messageKey) +
            "/status",
          {},
        )
      ).status,
      503,
    );
    assert.equal(
      (await call("/api/staff/email")).data.messages.find(
        (m: any) => m.key === messageKey,
      ).last_event,
      "opened",
    );
    providerHTTP = 403;
    assert.match(
      (
        await call(
          "/api/staff/email/message/" +
            encodeURIComponent(messageKey) +
            "/status",
          {},
        )
      ).data.error,
      /permission/,
    );
    providerHTTP = 200;
    providerEvent = "delivered";
    assert.equal(
      (
        await call(
          "/api/staff/email/message/" +
            encodeURIComponent(messageKey) +
            "/status",
          {},
        )
      ).data.event,
      "delivered",
    );
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
