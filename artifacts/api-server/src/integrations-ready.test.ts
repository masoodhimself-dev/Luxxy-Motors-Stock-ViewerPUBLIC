import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultEmailTemplates,
  renderEmailTemplate,
  validateEmailTemplate,
} from "@workspace/vehicle-meta";
import {
  DealerIntegrationsStore,
  applyIntegrationUpdate,
  effectiveResendSettings,
  integrationReadiness,
} from "./lib/dealer-integrations-store";
import { sendEmailWithSettings } from "./lib/email-provider";
import {
  validatePaidCheckout,
  verifyStripeWebhook,
  type StripeEvent,
} from "./lib/stripe-payments";
import { previewEmailTemplate } from "./lib/email-template-preview";
const resend = {
  enabled: false,
  apiKey: "re_syntheticIntegrationTestOnly",
  from: "Example Motors <hello@example.test>",
  replyTo: "accounts@example.test",
};
const stripe = {
  enabled: false,
  mode: "test" as const,
  publishableKey: "pk_test_syntheticIntegrationTestOnly",
  secretKey: "sk_test_syntheticIntegrationTestOnly",
  webhookSecret: "whsec_syntheticIntegrationTestOnly",
};
test("private settings default disabled; masked responses never contain any saved provider key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "luxxy-integration-private-"));
  const store = new DealerIntegrationsStore({
    filename: join(dir, "settings.json"),
    production: false,
  });
  try {
    const initial = await store.readMasked();
    assert.equal(initial.resend.enabled, false);
    assert.equal(initial.revision, 0);
    const result = await store.update({ expectedRevision: 0, resend });
    const response = JSON.stringify(result);
    for (const value of [
      resend.apiKey,
      stripe.publishableKey,
      stripe.secretKey,
      stripe.webhookSecret,
    ])
      assert.ok(!response.includes(value));
    assert.equal(result.resend.apiKeyConfigured, true);
    assert.equal(result.readiness.resend.ready, true);
    assert.equal((await stat(join(dir, "settings.json"))).mode & 0o777, 0o600);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    await assert.rejects(
      store.update({ expectedRevision: 0, resend }),
      /another session/,
    );
    await store.update({
      expectedRevision: 1,
      resend: { ...resend, apiKey: "", from: "Updated <hello@example.test>" },
    });
    assert.equal((await store.readPrivate()).resend.apiKey, resend.apiKey);
    await store.update({
      expectedRevision: 2,
      resend: {
        enabled: false,
        from: resend.from,
        replyTo: "",
        clearApiKey: true,
      },
    });
    assert.equal((await store.readMasked()).resend.apiKeyConfigured, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("production saving requires encryption, authenticated ciphertext cannot expose or silently corrupt keys", async () => {
  const dir = await mkdtemp(join(tmpdir(), "luxxy-integration-encrypted-")),
    filename = join(dir, "settings.json"),
    key = Buffer.alloc(32, 7).toString("base64");
  try {
    const missing = new DealerIntegrationsStore({
      filename,
      production: true,
      encryptionKey: "",
    });
    await assert.rejects(
      missing.update({ expectedRevision: 0, resend }),
      /INTEGRATIONS_ENCRYPTION_KEY/,
    );
    const store = new DealerIntegrationsStore({
      filename,
      production: true,
      encryptionKey: key,
    });
    await store.update({ expectedRevision: 0, resend });
    const disk = await readFile(filename, "utf8");
    assert.ok(!disk.includes(resend.apiKey));
    assert.ok(!disk.includes(stripe.secretKey));
    assert.equal(JSON.parse(disk).encrypted, true);
    assert.equal(
      (
        await new DealerIntegrationsStore({
          filename,
          production: true,
          encryptionKey: key,
        }).readPrivate()
      ).resend.apiKey,
      resend.apiKey,
    );
    await assert.rejects(
      new DealerIntegrationsStore({
        filename,
        production: true,
        encryptionKey: Buffer.alloc(32, 8).toString("base64"),
      }).readPrivate(),
      /could not be decrypted/,
    );
    const envelope = JSON.parse(disk);
    envelope.data = Buffer.from("altered ciphertext").toString("base64");
    await writeFile(filename, JSON.stringify(envelope));
    await assert.rejects(store.readPrivate(), /could not be decrypted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("all message families are editable, saved overrides preserve mandatory escaped facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "luxxy-email-templates-"));
  const store = new DealerIntegrationsStore({
    filename: join(dir, "settings.json"),
    production: false,
  });
  try {
    const ids = defaultEmailTemplates.map((item) => item.id);
    for (const id of [
      "enquiry_acknowledgement",
      "dealer_notification",
      "callback",
      "booking_request",
      "booking_confirmation",
      "booking_change",
      "booking_cancellation",
      "booking_reminder",
      "invoice",
      "payment_receipt",
      "balance_statement",
      "document_email",
    ])
      assert.ok(ids.includes(id));
    const result = await store.updateTemplate({
      id: "payment_receipt",
      expectedRevision: 0,
      subject: "Thank you {{customer_name}}",
      headline: "Your receipt from {{dealer_name}}",
      body: "<script>fake HTML</script>\nHello {{customer_name}}",
    });
    const template = result.templates.find(
      (item) => item.id === "payment_receipt",
    )!;
    const rendered = renderEmailTemplate(
      template,
      { customer_name: "<img src=x onerror=evil()>\r\nBCC: unsafe" },
      [
        { label: "Payment status", value: "confirmed" },
        { label: "Amount received", value: "£100.00" },
      ],
    );
    assert.equal(template.headline, "Your receipt from {{dealer_name}}");
    assert.ok(!rendered.html.includes("<script>"));
    assert.ok(!rendered.html.includes("<img"));
    assert.ok(rendered.html.includes("&lt;script&gt;"));
    assert.ok(rendered.html.includes("£100.00"));
    assert.ok(rendered.html.includes("confirmed"));
    assert.ok(!/[\r\n]/.test(rendered.subject));
    assert.throws(
      () =>
        validateEmailTemplate({
          subject: "Subject\nBCC: someone",
          body: "Message",
        }),
      /one line/,
    );
    assert.throws(
      () => validateEmailTemplate({ subject: "{{api_key}}", body: "Message" }),
      /Unknown variable/,
    );
    assert.throws(
      () => validateEmailTemplate({ subject: "Subject", body: "{{not_closed" }),
      /variables/,
    );
    const preview = previewEmailTemplate("booking_request", {
      subject: "Request",
      body: "Welcome",
    });
    assert.equal(preview.sent, false);
    assert.ok(preview.html.includes("awaiting confirmation"));
    const reset = await store.updateTemplate({
      id: "payment_receipt",
      expectedRevision: result.revision,
      reset: true,
    });
    assert.deepEqual(
      reset.templates.find((item) => item.id === "payment_receipt"),
      defaultEmailTemplates.find((item) => item.id === "payment_receipt"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("disabled Resend does not call a provider; stub delivery carries reply-to, PDF and idempotency", async () => {
  let calls = 0;
  const message = {
    to: "buyer@example.test",
    subject: "Receipt",
    html: "<p>Confirmed</p>",
    text: "Confirmed",
    idempotencyKey: "receipt-test",
    attachments: [{ filename: "receipt.pdf", content: "cGRm" }],
  };
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.resend.com/emails");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Idempotency-Key"), message.idempotencyKey);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.reply_to, resend.replyTo);
    assert.deepEqual(body.attachments, message.attachments);
    return new Response(JSON.stringify({ id: "email_synthetic" }));
  };
  await assert.rejects(
    sendEmailWithSettings(resend, message, transport),
    /disabled/,
  );
  assert.equal(calls, 0);
  assert.equal(
    await sendEmailWithSettings(
      { ...resend, enabled: true },
      message,
      transport,
    ),
    "email_synthetic",
  );
  assert.equal(calls, 1);
  await assert.rejects(
    sendEmailWithSettings(
      { ...resend, enabled: true },
      message,
      async () => new Response("sensitive upstream response", { status: 429 }),
    ),
    (error: unknown) =>
      error instanceof Error &&
      error.message === "Email provider returned HTTP 429.",
  );
});
test("plain email wording preserves environment delivery without accepting appearance edits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "luxxy-email-branding-"));
  const store = new DealerIntegrationsStore({
    filename: join(dir, "settings.json"),
    production: false,
  });
  const previous = {
    enabled: process.env.RESEND_ENABLED,
    key: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
  };
  try {
    process.env.RESEND_ENABLED = "true";
    process.env.RESEND_API_KEY = resend.apiKey;
    process.env.RESEND_FROM_EMAIL = resend.from;
    await store.updateTemplate({
      id: "invoice",
      expectedRevision: 0,
      subject: "Invoice",
      body: "Attached for {{customer_name}}.",
    });
    assert.equal(
      effectiveResendSettings(await store.readPrivate()).enabled,
      true,
    );
    assert.equal(
      typeof (store as unknown as Record<string, unknown>).updateAppearance,
      "undefined",
    );
    await assert.rejects(
      store.updateTemplate({
        id: "invoice",
        expectedRevision: 1,
        subject: "Invoice",
        body: "Your invoice",
        appearance: { logoUrl: "https://old.example.test/logo.svg" },
      }),
      /supported email template/,
    );
    await store.update({
      expectedRevision: 1,
      resend: { enabled: false, apiKey: "", from: resend.from, replyTo: "" },
    });
    assert.equal(
      effectiveResendSettings(await store.readPrivate()).enabled,
      false,
    );
  } finally {
    for (const [key, value] of [
      ["RESEND_ENABLED", previous.enabled],
      ["RESEND_API_KEY", previous.key],
      ["RESEND_FROM_EMAIL", previous.from],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
test("webhook signatures require original bytes, reject replay times and guard exact paid amounts", () => {
  const now = Date.now(),
    time = Math.floor(now / 1000);
  const hold = {
    id: "reservation-id",
    dealerId: "dealer-id",
    depositPence: 10000,
    sessionId: "cs_test_synthetic",
    mode: "test" as const,
  };
  const event: StripeEvent = {
    id: "evt_synthetic",
    type: "checkout.session.completed",
    livemode: false,
    created: time,
    data: {
      object: {
        id: hold.sessionId,
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        amount_total: 10000,
        currency: "gbp",
        client_reference_id: hold.id,
        metadata: { reservation_id: hold.id, dealer_id: hold.dealerId },
        payment_intent: "pi_synthetic",
      },
    },
  };
  const raw = Buffer.from(JSON.stringify(event)),
    signature = `t=${time},v1=${createHmac("sha256", stripe.webhookSecret).update(`${time}.`).update(raw).digest("hex")}`;
  const verified = verifyStripeWebhook(
    raw,
    signature,
    stripe.webhookSecret,
    now,
  );
  assert.deepEqual(validatePaidCheckout(verified, hold), {
    paymentIntentId: "pi_synthetic",
    sessionId: hold.sessionId,
    amountPence: 10000,
  });
  assert.throws(
    () =>
      verifyStripeWebhook(
        Buffer.from(JSON.stringify(event, null, 2)),
        signature,
        stripe.webhookSecret,
        now,
      ),
    /signature/,
  );
  assert.throws(
    () =>
      verifyStripeWebhook(raw, signature, stripe.webhookSecret, now + 301_000),
    /signature/,
  );
  assert.throws(
    () => verifyStripeWebhook(raw, signature, "whsec_wrongSecretOnly", now),
    /signature/,
  );
  for (const altered of [
    { amount_total: 1 },
    { currency: "usd" },
    { payment_status: "unpaid" },
    { payment_intent: "bad" },
    { client_reference_id: "other" },
  ])
    assert.throws(
      () =>
        validatePaidCheckout(
          { ...event, data: { object: { ...event.data.object, ...altered } } },
          hold,
        ),
      /does not match/,
    );
  assert.throws(
    () => validatePaidCheckout({ ...event, livemode: true }, hold),
    /does not match/,
  );
});
