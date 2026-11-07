import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import pino from "pino";
import { defaultEmailAppearance } from "@workspace/vehicle-meta";
import { createStaffDirectEmailRouter } from "./routes/staff-direct-email";
import { runWithTenant } from "./lib/tenant-context";

test("standalone staff emails use the approved recipient and literal branded copy", async () => {
  process.env.MULTI_TENANT_ENABLED = "false";
  process.env.PORTAL_API_TOKEN = "isolated-direct-email-token";
  const draft = {
    email: "customer@example.test",
    subject: "Documents for {{dealer_name}}",
    body: "Hi,\n\nPlease keep the text <script>test()</script> and {{reference}} with your records.",
  };
  let emailEnabled = false;
  let providerUnavailable = false;
  const providerId = randomUUID();
  const calls: { key: string | null; body: Record<string, unknown> }[] = [];
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
  app.use(createStaffDirectEmailRouter({
    profile: async () => ({
      identity: { name: "Sample Motors" },
      contact: {
        email: "hello@example.test",
        phone: "020 1234 5678",
        whatsapp: "",
        address: "1 Sample Road, London",
      },
    }),
    configuration: async () => ({
      version: 1,
      revision: 1,
      updatedAt: null,
      templates: {},
      appearance: defaultEmailAppearance,
      resend: {
        enabled: emailEnabled,
        apiKey: "re_recording_test_key",
        from: "Sample Motors <hello@example.test>",
        replyTo: "hello@example.test",
      },
      stripe: { enabled: false, mode: "test", publishableKey: "", secretKey: "", webhookSecret: "" },
    }),
    transport: async (_url, options) => {
      calls.push({
        key: new Headers(options?.headers).get("idempotency-key"),
        body: JSON.parse(String(options?.body)),
      });
      if (providerUnavailable) throw new Error("simulated timeout");
      return Response.json({ id: providerId });
    },
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}/staff/email/compose`;
  const token = { "x-portal-token": "isolated-direct-email-token" };
  const post = (route: string, input: object, headers: Record<string, string> = token) =>
    fetch(base + route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
    });
  const result = async (response: Response) => await response.json() as { code?: string; providerId?: string };
  try {
    assert.equal((await post("/preview", draft, {})).status, 401);
    assert.equal((await post("/preview", draft, { ...token, origin: "https://other-dealer.example.test" })).status, 403);
    assert.equal((await post("/preview", { ...draft, email: "invalid" })).status, 400);
    assert.equal((await post("/preview", { ...draft, subject: "Subject\nBcc: other@example.test" })).status, 400);

    const preview = await post("/preview", draft);
    assert.equal(preview.status, 200, await preview.clone().text());
    assert.equal(preview.headers.get("cache-control"), "no-store, private");
    const review = await preview.json() as { email: string; subject: string; html: string; text: string; previewHash: string };
    assert.equal(review.email, draft.email);
    assert.equal(review.subject, draft.subject);
    assert.ok(review.text.includes(draft.body));
    assert.match(review.html, /Sample Motors/);
    assert.match(review.html, /&lt;script&gt;test\(\)&lt;\/script&gt; and \{\{reference\}\}/);
    assert.doesNotMatch(review.html, /<script\b/i);
    assert.equal(calls.length, 0);

    const send = { ...draft, previewHash: review.previewHash, requestId: randomUUID() };
    const disabled = await post("/send", send);
    assert.equal(disabled.status, 503);
    assert.equal((await result(disabled)).code, "EMAIL_UNAVAILABLE");
    emailEnabled = true;
    const demo = await post("/send", send, { ...token, "x-demo": "yes" });
    assert.equal(demo.status, 403);
    assert.equal((await result(demo)).code, "EMAIL_UNAVAILABLE");
    const changed = await post("/send", { ...send, email: "someone-else@example.test" });
    assert.equal(changed.status, 409);
    assert.equal((await result(changed)).code, "EMAIL_PREVIEW_CHANGED");
    assert.equal(calls.length, 0);

    providerUnavailable = true;
    const unconfirmed = await post("/send", send);
    assert.equal(unconfirmed.status, 502);
    assert.equal((await result(unconfirmed)).code, "EMAIL_SEND_UNCONFIRMED");
    providerUnavailable = false;
    const retry = await post("/send", send);
    assert.equal(retry.status, 200, await retry.clone().text());
    assert.equal((await result(retry)).providerId, providerId);
    assert.match(calls[0]?.key ?? "", /^staff-email\/[a-f0-9]{64}$/);
    assert.deepEqual(calls[0], calls[1]);
    assert.deepEqual(calls[0]?.body, {
      from: "Sample Motors <hello@example.test>",
      to: [draft.email],
      subject: review.subject,
      html: review.html,
      text: review.text,
      reply_to: "hello@example.test",
    });
  } finally {
    server.close();
    delete process.env.MULTI_TENANT_ENABLED;
    delete process.env.PORTAL_API_TOKEN;
  }
});
