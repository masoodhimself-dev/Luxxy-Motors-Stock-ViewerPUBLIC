import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import pino from "pino";
import { saleWorkspaceBranding } from "@workspace/vehicle-meta";
import { createStaffLettersRouter } from "./routes/staff-letters";
import { runWithTenant } from "./lib/tenant-context";

test("staff letters print privately and send the approved PDF via an idempotent provider call", async () => {
  process.env.MULTI_TENANT_ENABLED = "false";
  process.env.PORTAL_API_TOKEN = "isolated-letter-token";
  const letter = {
    recipientName: "Sam Taylor",
    postalAddress: "1 Sample Road\nLondon\nSW1A 1AA",
    subject: "Your vehicle documents",
    body: "Dear Sam,\n\nPlease keep this letter with your documents.\n\nKind regards",
    date: "2026-11-07",
  };
  let dealerName = "Sample Motors";
  let emailEnabled = false;
  let providerUnavailable = false;
  const accepted = new Map<string, string>();
  const calls: { key: string; body: { to: string[]; subject: string; attachments: { filename: string; content: string }[] } }[] = [];
  const app = express();
  const logger = pino({ enabled: false });
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = logger;
    return runWithTenant({
      dealerId: "sample-dealer",
      canonicalOrigin: "https://dealer.example.test",
      platform: "cazoo",
      retailerId: "test",
      sourceUrl: "",
      demo: req.get("x-demo") === "yes",
    }, next);
  });
  app.use(createStaffLettersRouter({
    branding: async dealerId => {
      assert.equal(dealerId, "sample-dealer");
      return saleWorkspaceBranding({
        identity: { name: dealerName },
        contact: { email: "hello@example.test" },
      });
    },
    settings: async () => ({
      enabled: emailEnabled,
      apiKey: "re_recording_test_key",
      from: "Sample Motors <hello@example.test>",
      replyTo: "",
    }),
    transport: async (_url, options) => {
      const key = new Headers(options?.headers).get("idempotency-key")!;
      calls.push({ key, body: JSON.parse(String(options?.body)) });
      if (providerUnavailable) throw new Error("simulated timeout");
      if (!accepted.has(key)) accepted.set(key, randomUUID());
      return Response.json({ id: accepted.get(key) });
    },
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/staff/letters`;
  const token = { "x-portal-token": "isolated-letter-token" };
  const post = (route: string, input: object, headers: Record<string, string> = token) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
  const result = async (response: Response) => await response.json() as { code?: string; providerId?: string };
  try {
    assert.equal((await post("/preview", letter, {})).status, 401);
    assert.equal((await post("/preview", letter, { ...token, origin: "https://other-dealer.example.test" })).status, 403);
    assert.equal((await post("/preview", { ...letter, date: "2026-02-30" })).status, 400);
    assert.equal((await post("/preview", { ...letter, branding: { name: "Wrong dealership" } })).status, 400);

    dealerName = "";
    const unbranded = await post("/preview", letter);
    assert.equal(unbranded.status, 400);
    assert.match(await unbranded.text(), /Add the dealership name in Settings/);
    dealerName = "Sample Motors";

    const preview = await post("/preview", letter);
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get("content-type") ?? "", /^application\/json\b/);
    assert.equal(preview.headers.get("cache-control"), "no-store, private");
    const reviewed = await preview.json() as { pdfBase64: string; previewSvg: string; previewHash: string };
    const pdf = Buffer.from(reviewed.pdfBase64, "base64");
    assert.match(reviewed.previewSvg, /<svg\b/);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    const previewHash = createHash("sha256").update(pdf).digest("hex");
    assert.equal(reviewed.previewHash, previewHash);
    const markup = await post("/preview", { ...letter, subject: "<script>test()</script>" });
    assert.equal(markup.status, 200);
    const { previewSvg } = await markup.json() as { previewSvg: string };
    assert.match(previewSvg, /&lt;script&gt;test\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(previewSvg, /<script\b/i);
    assert.equal(calls.length, 0);

    const send = { ...letter, email: "sam@example.test", previewHash, requestId: randomUUID() };
    const disabled = await post("/send", send);
    assert.equal(disabled.status, 503);
    assert.equal((await result(disabled)).code, "LETTER_EMAIL_UNAVAILABLE");
    emailEnabled = true;
    assert.equal((await post("/send", send, { ...token, "x-demo": "yes" })).status, 403);
    const changed = await post("/send", { ...send, body: "The letter was changed after reviewing." });
    assert.equal(changed.status, 409);
    assert.equal((await result(changed)).code, "LETTER_PREVIEW_CHANGED");
    assert.equal(calls.length, 0);

    const first = await post("/send", send);
    assert.equal(first.status, 200, await first.clone().text());
    const providerId = (await result(first)).providerId;
    assert.deepEqual(calls[0]?.body.to, ["sam@example.test"]);
    assert.equal(calls[0]?.body.subject, letter.subject);
    assert.equal(calls[0]?.body.attachments[0]?.filename, "dealership-letter.pdf");
    assert.deepEqual(Buffer.from(calls[0]?.body.attachments[0]?.content ?? "", "base64"), pdf);

    providerUnavailable = true;
    const unconfirmed = await post("/send", send);
    assert.equal(unconfirmed.status, 502);
    assert.equal((await result(unconfirmed)).code, "LETTER_SEND_UNCONFIRMED");
    providerUnavailable = false;
    const retry = await post("/send", send);
    assert.equal(retry.status, 200, await retry.clone().text());
    assert.equal((await result(retry)).providerId, providerId);
    assert.equal(new Set(calls.map(call => call.key)).size, 1);
    assert.deepEqual(calls[0]?.body, calls[2]?.body);
  } finally {
    server.close();
    delete process.env.MULTI_TENANT_ENABLED;
    delete process.env.PORTAL_API_TOKEN;
  }
});
