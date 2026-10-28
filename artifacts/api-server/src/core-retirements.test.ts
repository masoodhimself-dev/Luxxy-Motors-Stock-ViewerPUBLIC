import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer, request } from "node:http";
import { engine } from "./test/tenant-test-db";
import { runWithTenant } from "./lib/tenant-context";
import router from "./routes";
process.env.MULTI_TENANT_ENABLED = "false";
test("removed product routes are absent from the actual router while old financial route safeguards remain", async () => {
  globalThis.fetch = async () => {
    throw new Error(
      "No external requests permitted in core retirement smoke test.",
    );
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.staff = {
      authUserId: "fictional-owner",
      name: "Owner",
      email: "owner@example.test",
      role: "owner",
    };
    req.log = { error() {}, warn() {}, info() {} } as any;
    runWithTenant(
      {
        dealerId: "retirement-test",
        canonicalOrigin: "https://retirement.example.test",
        platform: "autotrader",
        retailerId: "fictional",
        sourceUrl: "https://www.autotrader.co.uk/fictional",
      },
      next,
    );
  });
  app.use("/api", router);
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  const call = (method: string, path: string) =>
    new Promise<{ status: number; data: any }>((resolve, reject) => {
      const r = request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api" + path,
          method,
          headers: { "content-type": "application/json" },
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
      if (!["GET", "HEAD"].includes(method)) r.write("{}");
      r.end();
    });
  try {
    for (const [method, path] of [
      ["GET", "/dealer-reports"],
      ["POST", "/reservations"],
      ["POST", "/reservations/stripe/checkout"],
      ["GET", "/chat/session"],
      ["GET", "/staff/chat"],
      ["POST", "/vehicle-watches"],
      ["GET", "/vehicle-videos/id"],
      ["GET", "/staff/vehicle-videos"],
      ["POST", "/staff/vehicle-descriptions"],
      [
        "POST",
        "/staff/enquiries/00000000-0000-4000-8000-000000000001/ai-draft",
      ],
      ["POST", "/phone-shares"],
      ["POST", "/staff/phone-shares"],
      ["GET", "/enquiry-photo-upload/id"],
      ["GET", "/recent-handovers"],
      ["GET", "/staff/stock-change-tasks"],
      ["GET", "/staff/stock-health"],
      ["GET", "/staff/inventory"],
      ["PATCH", "/staff/vehicles/00000000-0000-4000-8000-000000000001/price"],
      ["GET", "/dealer-operations"],
      ["POST", "/service-book-upload"],
      ["PUT", "/email-templates/appearance"],
      ["GET", "/staff/phone-sharing-settings"],
      ["PUT", "/staff/phone-sharing-settings"],
      ["GET", "/staff/whatsapp-templates"],
      ["PUT", "/staff/whatsapp-templates"],
    ])
      assert.equal((await call(method, path)).status, 404, `${method} ${path}`);
    for (const path of [
      "/sales-test/sessions",
      "/sales-test/sessions/00000000-0000-4000-8000-000000000001/email-send",
      "/test-email-settings",
      "/sales",
      "/sales/old/complete",
      "/signing/old/complete",
      "/customer-intake-sessions/old/complete",
    ])
      assert.equal((await call("POST", path)).status, 410, path);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await engine.close();
  }
});
