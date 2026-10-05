import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultEmailTemplates, renderEmailTemplate, validateEmailAppearance, validateEmailTemplate } from '@workspace/vehicle-meta';
import { DealerIntegrationsStore, applyIntegrationUpdate, effectiveResendSettings, integrationReadiness } from './lib/dealer-integrations-store';
import { sendEmailWithSettings } from './lib/email-provider';
import { createStripeCheckoutSession, StripeCheckoutPreparationError, validatePaidCheckout, verifyStripeWebhook, type StripeEvent } from './lib/stripe-payments';
import { previewEmailTemplate } from './lib/email-template-preview';
const resend = { enabled: false, apiKey: 're_syntheticIntegrationTestOnly', from: 'Example Motors <hello@example.test>', replyTo: 'accounts@example.test' };
const stripe = { enabled: false, mode: 'test' as const, publishableKey: 'pk_test_syntheticIntegrationTestOnly', secretKey: 'sk_test_syntheticIntegrationTestOnly', webhookSecret: 'whsec_syntheticIntegrationTestOnly' };
test('private settings default disabled; masked responses never contain any saved provider key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'luxxy-integration-private-')); const store = new DealerIntegrationsStore({ filename: join(dir, 'settings.json'), production: false });
  try { const initial = await store.readMasked(); assert.equal(initial.resend.enabled, false); assert.equal(initial.stripe.enabled, false); assert.equal(initial.revision, 0);
    const result = await store.update({ expectedRevision: 0, resend, stripe });
    const response = JSON.stringify(result); for (const value of [resend.apiKey, stripe.publishableKey, stripe.secretKey, stripe.webhookSecret]) assert.ok(!response.includes(value));
    assert.equal(result.resend.apiKeyConfigured, true); assert.equal(result.readiness.resend.ready, true); assert.equal(result.stripe.enabled, false); assert.equal((await stat(join(dir, 'settings.json'))).mode & 0o777, 0o600); assert.equal((await stat(dir)).mode & 0o777, 0o700);
    await assert.rejects(store.update({ expectedRevision: 0, resend }), /another session/);
    await store.update({ expectedRevision: 1, resend: { ...resend, apiKey: '', from: 'Updated <hello@example.test>' } }); assert.equal((await store.readPrivate()).resend.apiKey, resend.apiKey);
    await store.update({ expectedRevision: 2, resend: { enabled: false, from: resend.from, replyTo: '', clearApiKey: true } }); assert.equal((await store.readMasked()).resend.apiKeyConfigured, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('production saving requires encryption, authenticated ciphertext cannot expose or silently corrupt keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'luxxy-integration-encrypted-')), filename = join(dir, 'settings.json'), key = Buffer.alloc(32, 7).toString('base64');
  try {
    const missing = new DealerIntegrationsStore({ filename, production: true, encryptionKey: '' }); await assert.rejects(missing.update({ expectedRevision: 0, resend }), /INTEGRATIONS_ENCRYPTION_KEY/);
    const store = new DealerIntegrationsStore({ filename, production: true, encryptionKey: key }); await store.update({ expectedRevision: 0, resend, stripe }); const disk = await readFile(filename, 'utf8'); assert.ok(!disk.includes(resend.apiKey)); assert.ok(!disk.includes(stripe.secretKey)); assert.equal(JSON.parse(disk).encrypted, true);
    assert.equal((await new DealerIntegrationsStore({ filename, production: true, encryptionKey: key }).readPrivate()).stripe.secretKey, stripe.secretKey);
    await assert.rejects(new DealerIntegrationsStore({ filename, production: true, encryptionKey: Buffer.alloc(32, 8).toString('base64') }).readPrivate(), /could not be decrypted/);
    const envelope = JSON.parse(disk); envelope.data = Buffer.from('altered ciphertext').toString('base64'); await writeFile(filename, JSON.stringify(envelope)); await assert.rejects(store.readPrivate(), /could not be decrypted/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('switching Stripe mode clears credentials and cannot silently enable live charges', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'luxxy-integration-mode-')); const store = new DealerIntegrationsStore({ filename: join(dir, 'settings.json'), production: false });
  try { await store.update({ expectedRevision: 0, stripe }); const current = await store.readPrivate(); assert.throws(() => applyIntegrationUpdate(current, { expectedRevision: 1, stripe: { enabled: true, mode: 'live' } }), /live/);
    await store.update({ expectedRevision: 1, stripe: { enabled: false, mode: 'live' } }); const result = await store.readPrivate(); assert.equal(result.stripe.secretKey, ''); assert.equal(result.stripe.webhookSecret, ''); assert.equal(result.stripe.publishableKey, '');
    assert.equal(integrationReadiness(result).stripe.ready, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('all message families are editable, saved overrides preserve mandatory escaped facts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'luxxy-email-templates-')); const store = new DealerIntegrationsStore({ filename: join(dir, 'settings.json'), production: false });
  try { const ids = defaultEmailTemplates.map(item => item.id); for (const id of ['enquiry_acknowledgement','dealer_notification','callback','booking_request','booking_confirmation','booking_change','booking_cancellation','booking_reminder','reservation_confirmation','reservation_payment','reservation_refund','invoice','payment_receipt','balance_statement','document_email','customer_access_link']) assert.ok(ids.includes(id));
    const result = await store.updateTemplate({ id: 'payment_receipt', expectedRevision: 0, subject: 'Thank you {{customer_name}}', body: '<script>fake HTML</script>\nHello {{customer_name}}' });
    const template = result.templates.find(item => item.id === 'payment_receipt')!; const rendered = renderEmailTemplate(template, { customer_name: '<img src=x onerror=evil()>\r\nBCC: unsafe' }, [{ label: 'Payment status', value: 'confirmed' }, { label: 'Amount received', value: '£100.00' }]);
    assert.ok(!rendered.html.includes('<script>')); assert.ok(!rendered.html.includes('<img')); assert.ok(rendered.html.includes('&lt;script&gt;')); assert.ok(rendered.html.includes('£100.00')); assert.ok(rendered.html.includes('confirmed')); assert.ok(!/[\r\n]/.test(rendered.subject));
    assert.throws(() => validateEmailTemplate({ subject: 'Subject\nBCC: someone', body: 'Message' }), /one line/); assert.throws(() => validateEmailTemplate({ subject: '{{api_key}}', body: 'Message' }), /Unknown variable/); assert.throws(() => validateEmailTemplate({ subject: 'Subject', body: '{{not_closed' }), /variables/);
    const preview = previewEmailTemplate('booking_request', { subject: 'Request', body: 'Welcome' }); assert.equal(preview.sent, false); assert.ok(preview.html.includes('awaiting confirmation'));
    const reset = await store.updateTemplate({ id: 'payment_receipt', expectedRevision: result.revision, reset: true }); assert.deepEqual(reset.templates.find(item => item.id === 'payment_receipt'), defaultEmailTemplates.find(item => item.id === 'payment_receipt'));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('disabled Resend does not call a provider; stub delivery carries reply-to, PDF and idempotency', async () => {
  let calls = 0; const message = { to: 'buyer@example.test', subject: 'Receipt', html: '<p>Confirmed</p>', text: 'Confirmed', idempotencyKey: 'receipt-test', attachments: [{ filename: 'receipt.pdf', content: 'cGRm' }] };
  const transport: typeof fetch = async (url, init) => { calls++; assert.equal(url, 'https://api.resend.com/emails'); const headers = new Headers(init?.headers); assert.equal(headers.get('Idempotency-Key'), message.idempotencyKey); const body = JSON.parse(String(init?.body)); assert.equal(body.reply_to, resend.replyTo); assert.deepEqual(body.attachments, message.attachments); return new Response(JSON.stringify({ id: 'email_synthetic' })); };
  await assert.rejects(sendEmailWithSettings(resend, message, transport), /disabled/); assert.equal(calls, 0); assert.equal(await sendEmailWithSettings({ ...resend, enabled: true }, message, transport), 'email_synthetic'); assert.equal(calls, 1);
  await assert.rejects(sendEmailWithSettings({ ...resend, enabled: true }, message, async () => new Response('sensitive upstream response', { status: 429 })), /^Error: Email provider returned HTTP 429\.$/);
});
test('email appearance is private, editable, safe and applied in previews while template edits preserve environment delivery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'luxxy-email-branding-')); const store = new DealerIntegrationsStore({ filename: join(dir, 'settings.json'), production: false });
  const previous = { enabled: process.env.RESEND_ENABLED, key: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL };
  try {
    process.env.RESEND_ENABLED = 'true'; process.env.RESEND_API_KEY = resend.apiKey; process.env.RESEND_FROM_EMAIL = resend.from;
    await store.updateTemplate({ id: 'invoice', expectedRevision: 0, subject: 'Invoice', body: 'Attached for {{customer_name}}.' });
    assert.equal(effectiveResendSettings(await store.readPrivate()).enabled, true);
    const appearance = { logoUrl: 'https://dealer.example/logo.png', brandColour: '#A47731', heading: 'Welcome to {{dealer_name}}', footer: 'Company information\n{{dealer_phone}}' };
    const response = await store.updateAppearance({ expectedRevision: 1, appearance }); assert.deepEqual(response.appearance, appearance);
    const rendered = previewEmailTemplate('invoice', { subject: 'Invoice', body: 'Your invoice' }, response.appearance); assert.ok(rendered.html.includes('https://dealer.example/logo.png')); assert.ok(rendered.html.includes('#A47731')); assert.ok(rendered.html.includes('Welcome to Example Motors')); assert.ok(rendered.html.includes('Company information')); assert.ok(rendered.html.includes('£100.00'));
    for (const logoUrl of ['http://dealer.example/logo.png', 'javascript:evil()', 'https://user:password@dealer.example/logo.png', 'https://dealer.example/" onerror="evil()']) assert.throws(() => validateEmailAppearance({ ...appearance, logoUrl }), /HTTPS/);
    assert.throws(() => validateEmailAppearance({ ...appearance, footer: '{{secret_key}}' }), /Unknown variable/);
    await store.update({ expectedRevision: 2, resend: { enabled: false, apiKey: '', from: resend.from, replyTo: '' } }); assert.equal(effectiveResendSettings(await store.readPrivate()).enabled, false);
  } finally { for (const [key, value] of [['RESEND_ENABLED', previous.enabled], ['RESEND_API_KEY', previous.key], ['RESEND_FROM_EMAIL', previous.from]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(dir, { recursive: true, force: true }); }
});
test('Stripe hosted checkout uses the server deposit snapshot, mode, idempotency and safe return URLs', async () => {
  const snapshot = { id: '9cebbd6d-18e9-4d3f-a2f4-3229883bce75', dealerId: 'sample-dealer', vehicleId: '9cebbd6d-18e9-4d3f-a2f4-3229883bce76', vehicleTitle: 'Example car', depositPence: 10000, email: 'buyer@example.test', expiresAt: new Date(Date.now() + 31 * 60_000).toISOString() }; const urls = { success: 'https://example.test/reserve/payment-return', cancel: 'https://example.test/vehicle/example' }; let calls = 0;
  const transport: typeof fetch = async (url, init) => { calls++; assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions'); const params = new URLSearchParams(String(init?.body)); assert.equal(params.get('line_items[0][price_data][unit_amount]'), '10000'); assert.equal(params.get('line_items[0][price_data][currency]'), 'gbp'); assert.equal(params.get('metadata[reservation_id]'), snapshot.id); assert.equal(params.get('payment_method_types[0]'), 'card'); assert.match(new Headers(init?.headers).get('Idempotency-Key')!, /reservation-checkout/); return new Response(JSON.stringify({ id: 'cs_test_synthetic', url: 'https://checkout.stripe.com/c/pay/synthetic', livemode: false })); };
  await assert.rejects(createStripeCheckoutSession(stripe, snapshot, urls, transport), /setup/); assert.equal(calls, 0); assert.equal((await createStripeCheckoutSession({ ...stripe, enabled: true }, snapshot, urls, transport)).id, 'cs_test_synthetic'); assert.equal(calls, 1);
  await assert.rejects(createStripeCheckoutSession({ ...stripe, enabled: true }, snapshot, urls, async () => new Response(JSON.stringify({ id: 'cs_test_bad', url: 'https://evil.example/pay', livemode: false }))), /invalid checkout address/);
});
test('webhook signatures require original bytes, reject replay times and guard exact paid amounts', () => {
  const now = Date.now(), time = Math.floor(now / 1000); const hold = { id: 'reservation-id', dealerId: 'dealer-id', depositPence: 10000, sessionId: 'cs_test_synthetic', mode: 'test' as const };
  const event: StripeEvent = { id: 'evt_synthetic', type: 'checkout.session.completed', livemode: false, created: time, data: { object: { id: hold.sessionId, mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 10000, currency: 'gbp', client_reference_id: hold.id, metadata: { reservation_id: hold.id, dealer_id: hold.dealerId }, payment_intent: 'pi_synthetic' } } };
  const raw = Buffer.from(JSON.stringify(event)), signature = `t=${time},v1=${createHmac('sha256', stripe.webhookSecret).update(`${time}.`).update(raw).digest('hex')}`;
  const verified = verifyStripeWebhook(raw, signature, stripe.webhookSecret, now); assert.deepEqual(validatePaidCheckout(verified, hold), { paymentIntentId: 'pi_synthetic', sessionId: hold.sessionId, amountPence: 10000 });
  assert.throws(() => verifyStripeWebhook(Buffer.from(JSON.stringify(event, null, 2)), signature, stripe.webhookSecret, now), /signature/); assert.throws(() => verifyStripeWebhook(raw, signature, stripe.webhookSecret, now + 301_000), /signature/); assert.throws(() => verifyStripeWebhook(raw, signature, 'whsec_wrongSecretOnly', now), /signature/);
  for (const altered of [{ amount_total: 1 }, { currency: 'usd' }, { payment_status: 'unpaid' }, { payment_intent: 'bad' }, { client_reference_id: 'other' }]) assert.throws(() => validatePaidCheckout({ ...event, data: { object: { ...event.data.object, ...altered } } }, hold), /does not match/);
  assert.throws(() => validatePaidCheckout({ ...event, livemode: true }, hold), /does not match/);
});
test('checkout preparation distinguishes definite rejection, recovered sessions and ambiguous failure without leaking provider content', async () => {
  const snapshot = { id: 'reservation-id', dealerId: 'dealer-id', vehicleId: 'vehicle-id', vehicleTitle: 'Example car', depositPence: 10000, email: 'buyer@example.test', expiresAt: new Date(Date.now() + 31 * 60_000).toISOString() }, urls = { success: 'https://example.test/return', cancel: 'https://example.test/cancel' }, settings = { ...stripe, enabled: true };
  await assert.rejects(createStripeCheckoutSession(settings, snapshot, urls, async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', param: 'expires_at', message: 'sensitive provider payload' } }), { status: 400 })), error => error instanceof StripeCheckoutPreparationError && error.definitiveFailure && error.failureParam === 'expires_at' && !error.message.includes('sensitive'));
  await assert.rejects(createStripeCheckoutSession(settings, snapshot, urls, async () => new Response('sensitive provider failure', { status: 500 })), error => error instanceof StripeCheckoutPreparationError && !error.definitiveFailure);
  await assert.rejects(createStripeCheckoutSession(settings, snapshot, urls, async () => new Response(JSON.stringify({ id: 'cs_test_recoverable', url: 'https://malicious.example/pay', livemode: false }))), error => error instanceof StripeCheckoutPreparationError && error.recoveredSessionId === 'cs_test_recoverable' && !error.definitiveFailure);
  await assert.rejects(createStripeCheckoutSession(settings, snapshot, urls, async () => { throw new Error('connection timed out; sensitive detail'); }), /could not be reached/);
});
