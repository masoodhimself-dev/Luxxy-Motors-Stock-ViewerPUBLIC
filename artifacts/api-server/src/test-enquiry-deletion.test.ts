import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { engine, pool } from './test/tenant-test-db';
import { explicitlyTestLabelled, testEnquiryDeletionRouter, TestEnquiryDeletionStore } from './lib/test-enquiry-deletion';
import { runWithTenant } from './lib/tenant-context';

process.env.MULTI_TENANT_ENABLED = 'true';
const dealer = 'test-cleanup-a';
const otherDealer = 'test-cleanup-b';
const fakePhone = '07700900123';
const fakeEmail = 'operator@example.test';

test('test labels are explicit and never mistake a test drive or incidental text for test data', () => {
  for (const value of ['TEST buyer', 'TEST: buyer', '[TEST] buyer', 'Test - scenario', 'TEST']) assert.equal(explicitlyTestLabelled(value), true, value);
  for (const value of ['Contest buyer', 'Latest customer', 'Buyer TEST', 'Test drive customer', 'TESTING', 'test-drive enquiry', null]) assert.equal(explicitlyTestLabelled(value), false, String(value));
});

test('isolated PostgreSQL test-only enquiry cleanup protects customers and financial history', async t => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  for (const id of [dealer, otherDealer]) await pool.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'autotrader','fictional','https://www.autotrader.co.uk/fictional')", [id, `https://${id}.example.test`]);
  const store = new TestEnquiryDeletionStore(pool);
  const create = async (overrides: Record<string, unknown> = {}) => {
    const row = { id: randomUUID(), dealer_id: dealer, customer_name: 'TEST: fictional customer', message: 'TEST: fictional enquiry only', type: 'general', source: 'phone', phone: fakePhone, email: fakeEmail, ...overrides };
    const columns = Object.keys(row), values = Object.values(row);
    await pool.query(`INSERT INTO enquiries(${columns.join(',')}) VALUES(${values.map((_, index) => `$${index + 1}`).join(',')})`, values);
    return String(row.id);
  };
  const event = async (id: string, detail: Record<string, unknown>, actor = 'dealer') => {
    const eventId = randomUUID();
    await pool.query("INSERT INTO enquiry_events(id,dealer_id,enquiry_id,kind,actor,summary,detail) VALUES($1,$2,$3,'conversation_logged',$4,'Conversation',$5::jsonb)", [eventId, dealer, id, actor, JSON.stringify(detail)]);
    return eventId;
  };
  const assertProtected = async (id: string, pattern: RegExp) => {
    const before = (await pool.query('SELECT * FROM enquiries WHERE id=$1', [id])).rows[0];
    const view = await store.inspect(dealer, id);
    assert.equal(view.canDelete, false);
    assert.match(view.reason!, pattern);
    await assert.rejects(store.remove(dealer, id, before.workspace_revision), pattern);
    assert.deepEqual((await pool.query('SELECT * FROM enquiries WHERE id=$1', [id])).rows[0], before);
  };
  await t.test('plain test enquiry deletes; replay cannot affect another record', async () => {
    const id = await create();
    assert.deepEqual(await store.inspect(dealer, id), { id, expectedRevision: 0, canDelete: true, reason: null });
    assert.deepEqual(await store.remove(dealer, id, 0), { deleted: true, id });
    assert.equal((await pool.query('SELECT id FROM enquiries WHERE id=$1', [id])).rows.length, 0);
    await assert.rejects(store.remove(dealer, id, 0), /not found/);
  });
  await t.test('same email and phone as real customer do not delete or change that customer or their messages', async () => {
    const realId = await create({ customer_name: 'Real buyer', message: 'Interested in a real car', source: 'website' });
    const customerId = randomUUID();
    await pool.query('INSERT INTO customers(id,dealer_id,name,email,phone)VALUES($1,$2,$3,$4,$5)', [customerId, dealer, 'Real buyer', fakeEmail, fakePhone]);
    const realEvent = await event(realId, { message: 'Keep this real customer message' });
    const snapshot = async () => Promise.all(['SELECT * FROM customers WHERE id=$1', 'SELECT * FROM enquiries WHERE id=$1', 'SELECT * FROM enquiry_events WHERE id=$1'].map((sql, index) => pool.query(sql, [[customerId, realId, realEvent][index]]).then(result => result.rows)));
    const before = await snapshot();
    const id = await create();
    await store.remove(dealer, id, 0);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('auto-created TEST WhatsApp enquiry and test-only grant revoke cleanly while preserving real grant', async () => {
    const id = await create({ source: 'whatsapp', message: 'Staff-created enquiry for a WhatsApp conversation.', status: 'contacted', workspace_revision: 1 });
    await event(id, { channel: 'whatsapp', message: 'TEST: delivery handoff only', recipientPhone: fakePhone });
    const testGrant = randomUUID(), realGrant = randomUUID();
    for (const [grant, payload] of [[testGrant, { enquiryId: id, customerName: 'TEST: fictional customer', customerPhone: fakePhone, messageBody: 'TEST: delivery handoff only', templateId: 'delivery', files: [] }], [realGrant, { customerName: 'Real buyer', message: 'Keep this link', files: [] }]] as const) await pool.query("INSERT INTO customer_phone_shares(id,dealer_id,request_id,token_hash,fingerprint,payload,created_by,expires_at)VALUES($1,$2,$3,$4,'fictional',$5::jsonb,'staff',now()+interval '1 day')", [grant, dealer, randomUUID(), randomUUID(), JSON.stringify(payload)]);
    const realBefore = (await pool.query('SELECT * FROM customer_phone_shares WHERE id=$1', [realGrant])).rows;
    await store.remove(dealer, id, 1);
    const removed = (await pool.query('SELECT * FROM customer_phone_shares WHERE id=$1', [testGrant])).rows[0];
    assert.ok(removed.revoked_at);
    assert.deepEqual(removed.payload, {});
    assert.deepEqual((await pool.query('SELECT * FROM customer_phone_shares WHERE id=$1', [realGrant])).rows, realBefore);
    assert.equal((await pool.query('SELECT id FROM enquiry_events WHERE enquiry_id=$1', [id])).rows.length, 0);
  });
  await t.test('untouched automatically opened TEST lead can be removed, but lead deposit history is protected', async () => {
    const id = await create(), leadId = randomUUID();
    await pool.query("INSERT INTO leads(id,dealer_id,enquiry_id,source,customer_name)VALUES($1,$2,$3,'phone','TEST: fictional customer')", [leadId, dealer, id]);
    await pool.query("INSERT INTO lead_events(lead_id,type,actor_type,payload)VALUES($1,'enquiry_received','customer','{}')", [leadId]);
    await store.remove(dealer, id, 0);
    assert.equal((await pool.query('SELECT id FROM leads WHERE id=$1', [leadId])).rows.length, 0);
    const protectedId = await create(), protectedLead = randomUUID();
    await pool.query("INSERT INTO leads(id,dealer_id,enquiry_id,source,customer_name)VALUES($1,$2,$3,'phone','TEST: fictional customer')", [protectedLead, dealer, protectedId]);
    await pool.query("INSERT INTO lead_events(lead_id,type,actor_type,payload)VALUES($1,'deposit_recorded','staff','{\"amountPence\":100}')", [protectedLead]);
    await assertProtected(protectedId, /financial history/);
  });
  await t.test('ordinary real customer and name-only TEST relabelling are blocked', async () => {
    for (const overrides of [{ customer_name: 'Real buyer' }, { message: 'Please tell me more about this car.' }, { customer_name: 'Test drive buyer', message: 'Test drive enquiry' }]) await assertProtected(await create(overrides), /clearly labelled/);
  });
  await t.test('historical appointments, merges, follow-ups and delivery attempts block deletion', async () => {
    for (const [overrides, pattern] of [
      [{ appointment_at: new Date(), appointment_cancelled_at: new Date() }, /appointments/],
      [{ appointment_revision: 1 }, /appointments/],
      [{ follow_up_revision: 1 }, /follow-up history/],
      [{ merged_at: new Date() }, /Merged/],
      [{ customer_notification_status: 'failed' }, /notification history/],
      [{ source: 'marketplace' }, /Marketplace/],
    ] as const) await assertProtected(await create(overrides), pattern);
  });
  await t.test('incoming or non-test conversations, invoice attachments and unlabelled grants are protected', async () => {
    for (const [detail, actor] of [[{ message: 'TEST: customer wrote this', direction: 'inbound' }, 'customer'], [{ message: 'Customer wants the car' }, 'dealer'], [{ message: 'TEST: invoice', attachmentNames: ['invoice.pdf'] }, 'dealer']] as const) {
      const id = await create(); await event(id, detail, actor); await assertProtected(id, /customer messages/);
    }
    const id = await create(), grant = randomUUID();
    await pool.query("INSERT INTO customer_phone_shares(id,dealer_id,request_id,token_hash,fingerprint,payload,created_by,expires_at)VALUES($1,$2,$3,$4,'fictional',$5::jsonb,'staff',now()+interval '1 day')", [grant, dealer, randomUUID(), randomUUID(), JSON.stringify({ enquiryId: id, customerName: 'TEST: fictional customer', message: 'Real document', files: [] })]);
    await assertProtected(id, /shared message or document/);
  });
  await t.test('sale workspace source and immutable document links are protected, even when the draft was detached', async () => {
    for (const state of [{ draft: { sourceEnquiryId: 'replace' } }, { documents: [{ snapshot: { draft: { sourceEnquiryId: 'replace' } } }], draft: {} }]) {
      const id = await create();
      await pool.query('INSERT INTO sale_workspace(id,dealer_id,reference,revision,state)VALUES($1,$2,$3,0,$4::jsonb)', [randomUUID(), dealer, randomUUID(), JSON.stringify(state).replace('replace', id)]);
      await assertProtected(id, /saved sale/);
    }
  });
  await t.test('legacy invoices, reversed payments and customer rows remain unchanged when linked test deletion is refused', async () => {
    const id = await create(), vehicleId = randomUUID(), customerId = randomUUID(), saleId = randomUUID();
    await pool.query("INSERT INTO vehicles(id,dealer_id,source,advert_id)VALUES($1,$2,'autotrader',$3)", [vehicleId, dealer, randomUUID()]);
    await pool.query("INSERT INTO customers(id,dealer_id,name,email,phone)VALUES($1,$2,'Real buyer',$3,$4)", [customerId, dealer, fakeEmail, fakePhone]);
    await pool.query('INSERT INTO sales(id,dealer_id,vehicle_id,customer_id,enquiry_id,agreed_price_pence,deposit_pence,balance_pence)VALUES($1,$2,$3,$4,$5,10000,1000,9000)', [saleId, dealer, vehicleId, customerId, id]);
    await pool.query("INSERT INTO sale_payments(sale_id,kind,amount_pence,status)VALUES($1,'deposit',1000,'reversed')", [saleId]);
    await pool.query("INSERT INTO invoices(sale_id,invoice_number,total_pence,deposit_pence,balance_pence,snapshot)VALUES($1,$2,10000,1000,9000,'{}')", [saleId, `TEST-INV-${randomUUID()}`]);
    const snapshot = () => Promise.all(['SELECT * FROM customers WHERE id=$1', 'SELECT * FROM sales WHERE id=$1', 'SELECT * FROM sale_payments WHERE sale_id=$1', 'SELECT * FROM invoices WHERE sale_id=$1', 'SELECT * FROM vehicles WHERE id=$1'].map((sql, index) => pool.query(sql, [[customerId, saleId, saleId, saleId, vehicleId][index]]).then(result => result.rows)));
    const before = await snapshot();
    await assertProtected(id, /connected to a sale/);
    assert.deepEqual(await snapshot(), before);
  });
  await t.test('email drafts with invoice attachments or send attempts are protected', async () => {
    for (const [content, status, sendId] of [[{ documentIds: [`${randomUUID()}:${randomUUID()}`] }, 'draft', null], [{}, 'sending', randomUUID()], [{}, 'sent', randomUUID()]] as const) {
      const id = await create();
      await pool.query('INSERT INTO enquiry_email_drafts(dealer_id,enquiry_id,status,content,updated_by,send_request_id)VALUES($1,$2,$3,$4::jsonb,\'staff\',$5)', [dealer, id, status, JSON.stringify(content), sendId]);
      await assertProtected(id, /invoice attachment or attempted email/);
    }
  });
  await t.test('reply routes, sent journals and queued outbox are protected', async () => {
    const routeId = await create();
    await pool.query('INSERT INTO enquiry_email_reply_routes(dealer_id,enquiry_id,send_key,reply_address,recipient)VALUES($1,$2,$3,$4,$5)', [dealer, routeId, randomUUID(), `${randomUUID()}@example.test`, fakeEmail]);
    await assertProtected(routeId, /emails, customer replies/);
    const sentId = await create();
    await pool.query("INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,created_by)VALUES($1,$2,$3,$4,'hash','sent',$5,'TEST: email','TEST: message','staff')", [randomUUID(), dealer, sentId, randomUUID(), fakeEmail]);
    await assertProtected(sentId, /emails, customer replies/);
    const outboxId = await create();
    await pool.query("INSERT INTO email_outbox(dealer_id,enquiry_id,kind,send_key,payload_hash,validation_hash,validation,account_hash,retry_deadline)VALUES($1,$2,'staff',$3,'hash','hash','{}','account',now()+interval '1 day')", [dealer, outboxId, randomUUID()]);
    await assertProtected(outboxId, /emails, customer replies/);
  });
  await t.test('stale revisions and foreign dealer IDs fail without modifying any row', async () => {
    const id = await create({ workspace_revision: 2 });
    await assert.rejects(store.remove(dealer, id, 1), /changed/);
    await assert.rejects(store.inspect(otherDealer, id), /not found/);
    await assert.rejects(store.remove(otherDealer, id, 2), /not found/);
    assert.equal((await pool.query('SELECT workspace_revision FROM enquiries WHERE id=$1', [id])).rows[0].workspace_revision, 2);
  });
  await t.test('HTTP requires staff sales permission, explicit acknowledgement and a current revision', async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      req.log = pino({ level: 'silent' });
      const role = req.get('x-test-role');
      if (role) req.staff = { authUserId: 'fictional-staff', name: 'Fictional staff', email: null, role: role as 'owner' | 'accounts' | 'salesperson' };
      else Object.assign(req, { auth: Object.assign(() => ({ userId: null }), { [Symbol.for('@clerk/express.auth')]: true }) });
      runWithTenant({ dealerId: dealer, canonicalOrigin: `https://${dealer}.example.test`, platform: 'autotrader', retailerId: 'fictional', sourceUrl: 'https://example.test', kind: 'website' }, next);
    });
    app.use('/api', testEnquiryDeletionRouter(store));
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/staff/enquiries`;
    const id = await create();
    const send = (method: string, role?: string, body?: unknown, origin?: string) => fetch(`${base}/${id}/deletion`, { method, headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}), ...(origin ? { origin } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    try {
      for (const method of ['GET', 'DELETE']) { assert.equal((await send(method)).status, 401); assert.equal((await send(method, 'accounts')).status, 403); }
      const inspected = await send('GET', 'salesperson'); assert.equal(inspected.status, 200); assert.equal(inspected.headers.get('cache-control'), 'no-store');
      for (const body of [{ expectedRevision: 0 }, { expectedRevision: -1, confirmTestOnly: true }, { expectedRevision: 0, confirmTestOnly: false }, { expectedRevision: 0, confirmTestOnly: true, override: true }]) assert.equal((await send('DELETE', 'owner', body)).status, 400);
      assert.equal((await send('DELETE', 'owner', { expectedRevision: 0, confirmTestOnly: true }, 'https://other-dealer.example.test')).status, 403);
      assert.equal((await send('DELETE', 'salesperson', { expectedRevision: 0, confirmTestOnly: true })).status, 200);
      assert.equal((await send('GET', 'owner')).status, 404);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  await engine.close();
});
