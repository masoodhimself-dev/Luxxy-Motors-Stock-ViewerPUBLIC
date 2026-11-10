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
  dealerSettingsTable,
  enquiriesTable,
  vehiclesTable,
  portalUsersTable,
  enquiryEmailsTable,
  enquiryEventsTable,
} from "./test/tenant-test-db";
import { resolveTenant } from "./middlewares/tenant";
import { createStaffEmailRouter } from "./routes/staff-email";
import {
  createEnquiryEmailRouter,
  rebuildStaffOutboxEmail,
} from "./routes/enquiry-emails";
import { deliverEmailOutbox } from "./lib/email-outbox";
import { runWithTenant } from "./lib/tenant-context";
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
    await db.insert(dealerSettingsTable).values({
      dealerId: dealer,
      config: {
        identity: { name: `Dealer ${dealer}` },
        contact: {
          email: `showroom-${dealer}@example.test`,
          phone: "07700 900123",
        },
        testDriveBooking: {
          instructions: "Please bring your driving licence.",
        },
        presentation: { parkingInstructions: "Use the visitor parking bay." },
      },
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
      reference: index === 0 ? "K4QM-9TXR" : "ACDE-3467",
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
    templates: {
      service_history: {
        subject: "Service photos",
        body: "Your photos are attached.",
        headline: "Your service photos, {{customer_name}}",
      },
      appointment_details: {
        subject: "Your appointment",
        body: "Time: {{appointment_time}}\nStatus: {{appointment_status}}\nDuration: {{duration}}\n{{visit_instructions}}\n{{parking_instructions}}",
      },
    },
    appearance: { ...defaultEmailAppearance },
  };
  const sends: any[] = [];
  let lastReplyTo = "";
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
      send: async (settings, body) => {
        lastReplyTo = settings.replyTo;
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
    templateId: "service_history",
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
    assert.equal(context.data.vehiclePdfAvailable, true);
    assert.ok(
      context.data.templates.some((t: any) => t.id === "service_history"),
    );
    assert.ok(
      context.data.templates.every(
        (t: any) => !t.message.includes("{{customer_name}}"),
      ),
    );
    assert.ok(!JSON.stringify(context.data).includes("re_fictional"));
    assert.ok(
      !context.data.defaults.message.includes("showroom-a@example.test"),
    );
    assert.ok(!context.data.defaults.message.includes("07700 900123"));
    assert.equal(
      context.data.templates.find((item: any) => item.id === "service_history")
        .message,
      "Your photos are attached.",
      "editable copy excludes automatic heading, facts and contact footer",
    );
    const appointmentCopy = context.data.templates.find(
      (item: any) => item.id === "appointment_details",
    ).message;
    assert.match(appointmentCopy, /5 January 2027/);
    assert.match(appointmentCopy, /11:00/);
    assert.doesNotMatch(appointmentCopy, /UK time|London time/);
    assert.match(appointmentCopy, /Awaiting showroom approval/);
    assert.match(appointmentCopy, /30 minutes/);
    assert.match(appointmentCopy, /driving licence/);
    assert.match(appointmentCopy, /visitor parking bay/);
    await db.update(enquiriesTable).set({ appointmentAt: new Date("2027-07-05T11:00:00Z") }).where(eq(enquiriesTable.id, enquiries[0]!));
    const summerContext = await call(base + "/email-context");
    const summerAppointmentCopy = summerContext.data.templates.find((item: any) => item.id === "appointment_details").message;
    assert.match(summerAppointmentCopy, /5 July 2027.*12:00/s);
    assert.doesNotMatch(summerAppointmentCopy, /UK time|London time/);
    await db.update(enquiriesTable).set({ appointmentAt: new Date("2027-01-05T11:00:00Z") }).where(eq(enquiriesTable.id, enquiries[0]!));
    assert.equal(
      (await call(base + "/email-preview", { ...draft, photoIds: [] })).status,
      400,
    );
    assert.equal(
      (await call(base + "/email-preview", draft)).status,
      400,
      "service-history copy needs a service-book photo, not only pre-accident photos",
    );
    const accidentPreview = await call(base + "/email-preview", {
      ...draft,
      templateId: "pre_accident_photos",
    });
    assert.equal(accidentPreview.status, 200);
    assert.match(accidentPreview.data.attachments[0].filename, /pre-accident/);
    await db.execute(
      sql`UPDATE vehicle_service_photos SET category='service_book' WHERE id=${photos[0]}::uuid`,
    );
    assert.equal(
      (
        await call(base + "/email-preview", {
          ...draft,
          templateId: "pre_accident_photos",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(base + "/email-preview", {
          ...draft,
          templateId: "invoice_copy",
          photoIds: [],
          documentIds: [],
        })
      ).status,
      400,
    );
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
    assert.match(preview.data.html, /<!doctype html>/i);
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
    assert.equal(
      sends[0].html,
      preview.data.html,
      "the reviewed design is exactly the HTML sent",
    );
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
    assert.ok(sends[0].attachments[0].filename.includes("service-book"));
    assert.equal(sends[0].attachments[0].filename, "vehicle-service-book-1.jpg");
    assert.doesNotMatch(sends[0].subject + sends[0].text + sends[0].html + sends[0].attachments[0].filename, /K4QM-9TXR|Enquiry reference:/);
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
    const noPhotos = { ...draft, templateId: "enquiry_message", photoIds: [] };
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
      to: "A@EXAMPLE.TEST",
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
    const sendCount = sends.length;
    const differentRecipient = { ...noPhotos, to: "other@example.test", documentIds: [`${saleId}:${invoiceId}`] };
    const recipientPreview = await call(base + "/email-preview", differentRecipient);
    assert.equal(recipientPreview.status, 409);
    assert.match(recipientPreview.data.error, /saved invoice has a different recipient/);
    const recipientSend = await call(base + "/email", {
      ...differentRecipient, requestId: randomUUID(), previewHash: invoicePreview.data.previewHash,
    });
    assert.equal(recipientSend.status, 409);
    assert.equal(sends.length, sendCount);
    assert.equal((await call(base + "/email-preview", { ...noPhotos, to: "other@example.test" })).status, 200);

    const correctedSale = { ...saleState, draft: { ...saleState.draft, email: "corrected@example.test" } };
    await engine.query("UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1::uuid", [saleId, JSON.stringify(correctedSale)]);
    assert.equal((await call(base + "/email-context")).data.invoices.length, 0);
    const staleInvoiceSend = await call(base + "/email", {
      ...noPhotos, documentIds: [`${saleId}:${invoiceId}`], requestId: randomUUID(), previewHash: invoicePreview.data.previewHash,
    });
    assert.equal(staleInvoiceSend.status, 409);
    assert.equal(sends.length, sendCount);
    await engine.query("UPDATE sale_workspace SET state=$2::jsonb WHERE id=$1::uuid", [saleId, JSON.stringify(saleState)]);
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
    await db
      .update(enquiriesTable)
      .set({ type: "general", appointmentAt: null, appointmentStatus: null })
      .where(eq(enquiriesTable.id, enquiries[0]));
    const generalContext = await call(base + "/email-context");
    const withoutAppointment = generalContext.data.templates.find(
      (item: any) => item.id === "appointment_details",
    ).message;
    assert.ok(!withoutAppointment.includes("Confirmed"));
    assert.ok(!withoutAppointment.includes("30 minutes"));
    // A queued approved message cannot acquire a new price/body under its old key.
    const queuedDraft = {
      ...noPhotos,
      expectedRevision: 1,
      includeAppointment: false,
    };
    const approved = await call(base + "/email-preview", queuedDraft);
    failure = "Email provider returned HTTP 429.";
    const queued = await call(base + "/email", {
      ...queuedDraft,
      requestId: randomUUID(),
      previewHash: approved.data.previewHash,
    });
    assert.equal(queued.status, 201);
    assert.equal(queued.data.delivery.status, "sending");
    assert.ok(queued.data.delivery.retryAt);
    assert.equal(queued.data.delivery.attempts, 1);
    const [outbox] = (
      await db.execute(
        sql`SELECT id FROM email_outbox WHERE delivery_id=${queued.data.delivery.id}::uuid AND dealer_id='a'`,
      )
    ).rows;
    await db
      .update(vehiclesTable)
      .set({ sourcePrice: 8600 })
      .where(eq(vehiclesTable.id, cars[0]));
    const before = sends.length;
    await runWithTenant(
      {
        dealerId: "a",
        canonicalOrigin: "https://a.example.test",
        platform: "autotrader",
        retailerId: "a",
        sourceUrl: "https://www.autotrader.co.uk/example",
      },
      async () => {
        const outcome = await deliverEmailOutbox(String(outbox!.id), {
          now: new Date(Date.parse(queued.data.delivery.retryAt) + 1000),
          settings: async () => config.resend,
          rebuild: (row) => rebuildStaffOutboxEmail(row, config),
          send: async () => {
            assert.fail("Changed price must not be sent");
          },
        });
        assert.equal(outcome!.status, "unknown");
      },
    );
    assert.equal(sends.length, before);
    const refreshed = await call(base + "/email-context");
    assert.equal(
      refreshed.data.deliveries.find(
        (row: any) => row.id === queued.data.delivery.id,
      ).status,
      "unknown",
    );

    // A real template PDF goes through the same reviewed, scoped and
    // idempotent send flow as other attachments (recording transport only).
    failure = null;
    const pdfDraft = { ...queuedDraft, attachVehiclePdf: true };
    const pdfPreview = await call(base + "/email-preview", pdfDraft);
    assert.equal(pdfPreview.status, 200);
    assert.equal(pdfPreview.data.attachments.length, 1);
    assert.match(pdfPreview.data.attachments[0].filename, /\.pdf$/);
    assert.ok(pdfPreview.data.attachments[0].byteSize > 1000);
    assert.equal((await call(base + "/email-preview", pdfDraft)).data.previewHash, pdfPreview.data.previewHash);
    const pdfPayload = { ...pdfDraft, requestId: randomUUID(), previewHash: pdfPreview.data.previewHash };
    assert.equal((await call(base + "/email", { ...pdfPayload, attachVehiclePdf: false })).status, 409, "PDF cannot be removed after review without a new preview");
    await db.update(vehiclesTable).set({ sourcePrice: 8400 }).where(eq(vehiclesTable.id, cars[0]));
    assert.equal((await call(base + "/email", pdfPayload)).status, 409, "a changed PDF price needs a fresh preview");
    await db.update(vehiclesTable).set({ sourcePrice: 8600, inventoryStatus: "sold" }).where(eq(vehiclesTable.id, cars[0]));
    assert.equal((await call(base + "/email-context")).data.vehiclePdfAvailable, false);
    assert.equal((await call(base + "/email-preview", pdfDraft)).status, 409, "sold stock cannot be attached");
    await db.update(vehiclesTable).set({ inventoryStatus: "available" }).where(eq(vehiclesTable.id, cars[0]));
    await db.update(enquiriesTable).set({ vehicleId: cars[1] }).where(eq(enquiriesTable.id, enquiries[0]));
    assert.equal((await call(base + "/email-context")).data.vehiclePdfAvailable, false);
    assert.equal((await call(base + "/email-preview", pdfDraft)).status, 409, "a cross-dealer link cannot disclose another dealer's PDF");
    await db.update(enquiriesTable).set({ vehicleId: cars[0] }).where(eq(enquiriesTable.id, enquiries[0]));
    // The earlier fictional HTTP-429 test deliberately cooled this account.
    await db.execute(sql`UPDATE email_account_throttle SET next_allowed_at=now()-interval '1 second'`);
    const beforePdfSend = sends.length;
    const pdfSent = await call(base + "/email", pdfPayload);
    assert.equal(pdfSent.status, 201);
    assert.equal(pdfSent.data.delivery.status, "sent", JSON.stringify(pdfSent.data));
    assert.equal(pdfSent.data.delivery.documentCount, 1);
    assert.equal(sends.length, beforePdfSend + 1);
    assert.equal(Buffer.from(sends.at(-1).attachments[0].content, "base64").subarray(0, 5).toString(), "%PDF-");
    assert.equal((await call(base + "/email", pdfPayload)).status, 200);
    assert.equal(sends.length, beforePdfSend + 1, "an exact retry does not send a second PDF email");

    // Cazoo staff replies use the same reviewed transport and scoped thread.
    const cazooId = randomUUID(), routeId = randomUUID(), sender = "customer@example.test", mergedEnquiryId = randomUUID();
    const replyId = randomUUID(), laterReplyId = randomUUID(), reviewReplyId = randomUUID();
    const originalContact = "original-contact@example.test";
    const inboundMessageId = "<customer-reply@example.test>";
    await db.insert(enquiriesTable).values({
      id: cazooId, dealerId: "a", type: "general", source: "cazoo",
      customerName: "Example Customer", email: originalContact, message: "Is this still available?",
    });
    await db.execute(sql`INSERT INTO enquiry_email_reply_routes(id,dealer_id,enquiry_id,send_key,reply_address,recipient) VALUES(${routeId}::uuid,'a',${cazooId}::uuid,'prior-send','r-prior@replies.a.example.test',${sender})`);
    await db.execute(sql`INSERT INTO enquiry_email_replies(id,provider_id,route_id,dealer_id,enquiry_id,status,sender,message_id,subject,received_at) VALUES
      (${replyId}::uuid,${randomUUID()}::uuid,${routeId}::uuid,'a',${cazooId}::uuid,'received',${sender},${inboundMessageId},'Re: re: Is this still available?',now()-interval '1 minute'),
      (${laterReplyId}::uuid,${randomUUID()}::uuid,${routeId}::uuid,'a',${cazooId}::uuid,'received',${sender},'<later-message@example.test>',${"Re:\nBad subject"},now()),
      (${reviewReplyId}::uuid,${randomUUID()}::uuid,${routeId}::uuid,'a',${cazooId}::uuid,'review','unverified@example.test','<unverified@example.test>',NULL,now())`);
    process.env.EMAIL_REPLIES_ENABLED = "true";
    process.env.RESEND_RECEIVING_API_KEY = "re_fictional_receiving_not_used";
    process.env.RESEND_RECEIVING_WEBHOOK_SECRET = "fictional_receiving_secret";
    process.env.EMAIL_REPLY_DOMAINS = JSON.stringify({ a: "replies.a.example.test" });
    const cazoo = `/api/staff/enquiries/${cazooId}`;
    const replyContext = await call(cazoo + "/email-context?enquiryReplyId=" + replyId);
    assert.equal(replyContext.data.email, originalContact);
    assert.deepEqual(replyContext.data.replyRecipient, { id: replyId, from: sender, subject: "Re: Is this still available?" });
    assert.equal((await call(cazoo + "/email-context?enquiryReplyId=" + laterReplyId)).data.replyRecipient.subject, null);
    assert.equal((await call(cazoo + "/email-context?enquiryReplyId=" + reviewReplyId)).data.replyRecipient, null);
    assert.equal((await call(base + "/email-context?enquiryReplyId=" + replyId)).data.replyRecipient, null);
    assert.equal((await call(cazoo + "/email-context?enquiryReplyId=" + replyId, undefined, "user_b", "b")).status, 404);
    // An existing receipt can remain on the original case after an explicit merge.
    await db.insert(enquiriesTable).values({
      id: mergedEnquiryId, dealerId: "a", type: "general", source: "cazoo", customerName: "Example Customer",
      email: originalContact, message: "Merged record", mergedIntoId: cazooId, mergedAt: new Date(), mergedBy: "user_a",
    });
    await db.execute(sql`UPDATE enquiry_email_replies SET enquiry_id=${mergedEnquiryId}::uuid WHERE id=${replyId}::uuid`);
    assert.deepEqual((await call(cazoo + "/email-context?enquiryReplyId=" + replyId)).data.replyRecipient, replyContext.data.replyRecipient);
    const replyDraft = { to: sender, enquiryReplyId: replyId, subject: "Re: Your enquiry", message: "Thanks for getting back to us.", includeVehicle: false, includeAppointment: false, photoIds: [], expectedRevision: 0 };
    assert.equal((await call(cazoo + "/email-preview", { ...replyDraft, to: originalContact })).status, 409);
    assert.equal((await call(cazoo + "/email-preview", { ...replyDraft, enquiryReplyId: reviewReplyId })).status, 409);
    const replyPreview = await call(cazoo + "/email-preview", replyDraft);
    assert.equal(replyPreview.status, 200);
    assert.equal(replyPreview.data.from, config.resend.from);
    assert.equal(replyPreview.data.repliesInInbox, true);
    assert.ok(!JSON.stringify(replyPreview.data).includes("re_fictional"));
    assert.equal((await db.execute(sql`SELECT count(*)::int AS n FROM enquiry_email_reply_routes WHERE enquiry_id=${cazooId}::uuid`)).rows[0]?.n, 1, "preview never issues a new reply address");
    const replyPayload = { ...replyDraft, requestId: randomUUID(), previewHash: replyPreview.data.previewHash };
    const beforeReplySend = sends.length;
    assert.equal((await call(cazoo + "/email", { ...replyPayload, enquiryReplyId: laterReplyId })).status, 409, "a different same-sender reply requires another review");
    const from = config.resend.from;
    config.resend.from = "changed-sender@example.test";
    assert.equal((await call(cazoo + "/email", replyPayload)).status, 409, "a different From needs another review");
    config.resend.from = from;
    process.env.EMAIL_REPLIES_ENABLED = "false";
    const unrouted = await call(cazoo + "/email-preview", replyDraft);
    assert.equal(unrouted.data.from, from);
    assert.equal(unrouted.data.repliesInInbox, false);
    assert.equal((await call(cazoo + "/email", replyPayload)).status, 409, "changed reply routing needs another review");
    config.resend.enabled = false;
    const unavailable = await call(cazoo + "/email-preview", replyDraft);
    assert.equal(unavailable.status, 200, "staff can still review wording while sending is off");
    assert.equal(unavailable.data.from, null);
    assert.equal(unavailable.data.repliesInInbox, false);
    config.resend.enabled = true;
    process.env.EMAIL_REPLIES_ENABLED = "true";
    assert.equal(sends.length, beforeReplySend);
    await db.execute(sql`UPDATE email_account_throttle SET next_allowed_at=now()-interval '1 second'`);
    const replySent = await call(cazoo + "/email", replyPayload);
    assert.equal(replySent.status, 201, JSON.stringify(replySent.data));
    assert.equal(replySent.data.delivery.status, "sent");
    assert.equal(sends.length, beforeReplySend + 1);
    assert.match(lastReplyTo, /^r-[a-f0-9]{48}@replies\.a\.example\.test$/);
    assert.deepEqual(sends.at(-1).replyHeaders, { "In-Reply-To": inboundMessageId, References: inboundMessageId });
    assert.equal((await db.select().from(enquiryEmailsTable).where(eq(enquiryEmailsTable.id, replySent.data.delivery.id)))[0]?.providerId, providerId);
    const handled = (await db.execute(sql`SELECT id FROM enquiry_email_replies WHERE dealer_id='a' AND enquiry_id IN (${cazooId}::uuid,${mergedEnquiryId}::uuid) AND resolved_at IS NOT NULL`)).rows;
    assert.deepEqual(handled.map((row) => row.id), [replyId], "only the selected reply is marked handled");
    const handledContext = (await call(cazoo + "/email-context?enquiryReplyId=" + replyId)).data;
    assert.deepEqual(handledContext.replyRecipient, { id: replyId, from: sender, subject: "Re: Is this still available?" }, "handled links remain useful for follow-up");
    assert.equal(handledContext.email, originalContact);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
  }
});
