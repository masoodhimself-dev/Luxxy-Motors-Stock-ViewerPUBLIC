import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, request } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  engine,
  db,
  dealershipsTable,
  dealerDomainsTable,
  enquiriesTable,
  portalUsersTable,
} from "./test/tenant-test-db";
import { resolveTenant } from "./middlewares/tenant";
import { createStaffNotificationsRouter } from "./routes/staff-notifications";
import { createEnquiryEmailRouter } from "./routes/enquiry-emails";
import { defaultEmailAppearance } from "@workspace/vehicle-meta";
import type { PrivateDealerSettings } from "./lib/dealer-integrations-store";

process.env.MULTI_TENANT_ENABLED = "true";
test("notification home and saved drafts: dealer isolation, permissions, version conflicts, reviewed send and uncertain acceptance", async () => {
  for (const name of (await readdir("../../lib/db/drizzle"))
    .filter((n) => /^\d.*\.sql$/.test(n))
    .sort())
    await engine.exec(await readFile("../../lib/db/drizzle/" + name, "utf8"));
  const ids = [randomUUID(), randomUUID()];
  for (const [index, dealer] of ["a", "b"].entries()) {
    await db
      .insert(dealershipsTable)
      .values({
        id: dealer,
        name: dealer,
        status: "active",
        canonicalOrigin: `https://${dealer}.example.test`,
        stockPlatform: "autotrader",
        retailerId: dealer,
        sourceUrl: "https://www.autotrader.co.uk/example",
      });
    await db
      .insert(dealerDomainsTable)
      .values({
        hostname: `${dealer}.example.test`,
        dealerId: dealer,
        verified: true,
        verificationToken: "fictional",
      });
    await db
      .insert(portalUsersTable)
      .values({
        dealerId: dealer,
        authUserId: `user_${dealer}`,
        role: "owner",
      });
    await db
      .insert(enquiriesTable)
      .values({
        id: ids[index],
        dealerId: dealer,
        type: "general",
        customerName: `Customer ${dealer}`,
        email: `${dealer}@example.test`,
        message: "Please tell me about this car.",
        followUpAt: new Date(Date.now() - 3600000),
      });
  }
  await db
    .insert(portalUsersTable)
    .values({ dealerId: "a", authUserId: "accounts", role: "accounts" });
  const config: PrivateDealerSettings = {
    version: 1,
    revision: 0,
    updatedAt: null,
    resend: {
      enabled: true,
      apiKey: "re_fictional",
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
  let sends = 0,
    uncertain = false;
  const app = express();
  app.use(express.json());
  app.use(resolveTenant);
  app.use("/api", createStaffNotificationsRouter());
  app.use(
    "/api",
    createEnquiryEmailRouter({
      settings: async () => config,
      send: async () => {
        sends++;
        if (uncertain) throw new Error("network interrupted");
        return randomUUID();
      },
    }),
  );
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const call = (
    path: string,
    body?: unknown,
    user = "user_a",
    host = "a",
    origin = "",
  ) =>
    new Promise<{ status: number; data: any }>((resolve) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: body === undefined ? "GET" : "POST",
          headers: {
            host: `${host}.example.test`,
            "content-type": "application/json",
            ...(user ? { "x-test-user": user } : {}),
            ...(origin ? { origin } : {}),
          },
        },
        (res) => {
          let content = "";
          res.on("data", (v) => (content += v));
          res.on("end", () =>
            resolve({ status: res.statusCode!, data: JSON.parse(content) }),
          );
        },
      );
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const draft = {
    to: "a@example.test",
    subject: "Hello",
    message: "Please call the team.",
    includeVehicle: false,
    includeAppointment: false,
    photoIds: [],
    documentIds: [],
    expectedRevision: 0,
  };
  const base = `/api/staff/enquiries/${ids[0]}`;
  try {
    assert.equal(
      (await call("/api/staff/notifications", undefined, "")).status,
      401,
    );
    assert.equal(
      (await call("/api/staff/email-drafts", undefined, "accounts")).status,
      403,
    );
    assert.equal(
      (
        await call(
          base + "/email-draft",
          { expectedVersion: 0, content: draft },
          "user_a",
          "a",
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await call(`/api/staff/enquiries/${ids[1]}/email-draft`, {
          expectedVersion: 0,
          content: draft,
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call(base + "/email-draft", {
          expectedVersion: 0,
          content: { ...draft, source: "ai" },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(base + "/email-draft", {
          expectedVersion: 0,
          content: { ...draft, subject: "", message: "" },
        })
      ).status,
      200,
    );
    assert.equal(sends, 0, "saving incomplete drafts makes no provider call");
    assert.equal(
      (await call(base + "/email-context")).data.savedDraft.content.message,
      "",
    );
    const concurrent = await Promise.all([
      call(base + "/email-draft", { expectedVersion: 1, content: draft }),
      call(base + "/email-draft", {
        expectedVersion: 1,
        content: { ...draft, message: "Different staff edit" },
      }),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      (
        await call(base + "/email-draft", {
          expectedVersion: 2,
          content: draft,
        })
      ).status,
      200,
    );
    const queue = await call("/api/staff/email-drafts");
    assert.equal(queue.data.drafts.length, 1);
    assert.equal(queue.data.drafts[0].version, 3);
    assert.equal((await call(`/api/staff/email-drafts?enquiryId=${ids[0]}`)).data.drafts.length, 1);
    assert.equal((await call(`/api/staff/email-drafts?enquiryId=${ids[1]}`)).data.drafts.length, 0);
    assert.equal((await call('/api/staff/email-drafts?enquiryId=invalid')).status, 400);
    assert.equal(
      (await call("/api/staff/email-drafts", undefined, "user_b", "b")).data
        .drafts.length,
      0,
    );
    const notifications = await call("/api/staff/notifications");
    assert.equal(notifications.status, 200);
    assert.equal(notifications.data.counts.enquiries, 1);
    assert.equal(notifications.data.counts.followups, 1);
    assert.equal(notifications.data.counts.drafts, 1);
    assert.ok(
      notifications.data.items.every((r: any) => r.customer === "Customer a"),
    );
    assert.equal(notifications.data.capabilities.automaticSending, false);
    const accounts = await call(
      "/api/staff/notifications",
      undefined,
      "accounts",
    );
    assert.equal(accounts.data.counts.drafts, 0);
    assert.equal(accounts.data.emailAccess, false);
    let preview = await call(base + "/email-preview", draft);
    assert.equal(preview.status, 200);
    const send = {
      ...draft,
      savedDraftVersion: 3,
      requestId: randomUUID(),
      previewHash: preview.data.previewHash,
    };
    assert.equal(
      (await call(base + "/email", { ...send, savedDraftVersion: 2 })).status,
      409,
    );
    assert.equal(sends, 0);
    assert.equal((await call(base + "/email", send)).status, 201);
    assert.equal(sends, 1);
    assert.equal((await call(base + "/email", send)).data.replayed, true);
    assert.equal(sends, 1);
    assert.equal((await call("/api/staff/email-drafts")).data.drafts.length, 0);
    assert.equal(
      (
        await call(base + "/email-draft", {
          expectedVersion: 3,
          content: draft,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call(base + "/email-draft", {
          expectedVersion: 4,
          content: draft,
        })
      ).status,
      200,
    );
    uncertain = true;
    preview = await call(base + "/email-preview", draft);
    const unknown = {
      ...draft,
      savedDraftVersion: 5,
      requestId: randomUUID(),
      previewHash: preview.data.previewHash,
    };
    assert.equal(
      (await call(base + "/email", unknown)).data.delivery.status,
      "unknown",
    );
    assert.equal(
      (
        await call(base + "/email-draft", {
          expectedVersion: 6,
          content: draft,
        })
      ).status,
      409,
    );
    assert.equal(
      (await call(base + "/email-draft/discard", { expectedVersion: 6 }))
        .status,
      409,
    );
    assert.equal((await call(base + "/email", unknown)).data.replayed, true);
    assert.equal(sends, 2);
    assert.equal((await call("/api/staff/notifications")).data.counts.email, 1);
    await db.execute(
      sql`UPDATE enquiries SET status='contacted',follow_up_completed_at=now() WHERE dealer_id='a'`,
    );
    const after = await call("/api/staff/notifications");
    assert.equal(after.data.counts.enquiries, 0);
    assert.equal(after.data.counts.followups, 0);
    // Discard tombstones keep the version, preventing an old tab from resurrecting a draft.
    const b = `/api/staff/enquiries/${ids[1]}/email-draft`;
    assert.equal(
      (
        await call(
          b,
          { expectedVersion: 0, content: { ...draft, to: "b@example.test" } },
          "user_b",
          "b",
        )
      ).status,
      200,
    );
    assert.equal(
      (await call(b + "/discard", { expectedVersion: 1 }, "user_b", "b"))
        .status,
      200,
    );
    assert.equal(
      (await call(b, { expectedVersion: 1, content: draft }, "user_b", "b"))
        .status,
      409,
    );
    assert.equal(
      (await call("/api/staff/email-drafts", undefined, "user_b", "b")).data
        .drafts.length,
      0,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await engine.close();
  }
});
