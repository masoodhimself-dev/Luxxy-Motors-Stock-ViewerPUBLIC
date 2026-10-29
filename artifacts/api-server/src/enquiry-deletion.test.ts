import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { engine, pool } from './test/tenant-test-db';
import { EnquiryDeletionStore, enquiryDeletionRouter } from './lib/enquiry-deletion';
import { runWithTenant } from './lib/tenant-context';

process.env.MULTI_TENANT_ENABLED = 'true';
const dealer = 'deletion-test-dealer-a', other = 'deletion-test-dealer-b';
const now = new Date('2026-10-29T12:00:00Z');
const store = new EnquiryDeletionStore(pool, { clock: () => now });

test('confirmed enquiry deletion uses real isolated PostgreSQL protections', async t => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  for (const id of [dealer, other]) await pool.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'autotrader','fixture','https://www.autotrader.co.uk/fixture')", [id, `https://${id}.example.test`]);
  const create = async (change: Record<string, unknown> = {}) => {
    const row = { id: randomUUID(), dealer_id: dealer, customer_name: 'A normal customer', message: 'Please tell me about this car', email: 'buyer@example.test', phone: '07700900123', type: 'general', ...change };
    const columns = Object.keys(row);
    await pool.query(`INSERT INTO enquiries(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row));
    return String(row.id);
  };
  const protectedEnquiry = async (id: string, pattern: RegExp) => {
    const before = (await pool.query('SELECT * FROM enquiries WHERE id=$1', [id])).rows;
    const view = await store.inspect(dealer, id);
    assert.equal(view.canDelete, false); assert.match(view.reason!, pattern);
    await assert.rejects(store.remove(dealer, id, view.expectedRevision, 'staff', true), pattern);
    assert.deepEqual((await pool.query('SELECT * FROM enquiries WHERE id=$1', [id])).rows, before);
  };
  await t.test('wrong tenant, stale revision and missing confirmation do not change enquiries', async () => {
    const id = await create({ workspace_revision: 2 });
    await assert.rejects(store.inspect(other, id), /not found/);
    await assert.rejects(store.remove(other, id, 2, 'staff', true), /not found/);
    await assert.rejects(store.remove(dealer, id, 1, 'staff', true), /changed/);
    await assert.rejects(store.remove(dealer, id, 2, 'staff', false), /confirm permanent deletion/);
    assert.equal((await pool.query('SELECT workspace_revision FROM enquiries WHERE id=$1', [id])).rows[0].workspace_revision, 2);
  });
  await t.test('ordinary enquiry and its conversation delete while the matching real customer, lead and other thread survive', async () => {
    const id = await create(), otherId = await create(), customerId = randomUUID(), leadId = randomUUID();
    await pool.query("INSERT INTO customers(id,dealer_id,name,email,phone)VALUES($1,$2,'A normal customer','buyer@example.test','07700900123')", [customerId, dealer]);
    await pool.query("INSERT INTO leads(id,dealer_id,enquiry_id,customer_name,source,stage) VALUES($1,$2,$3,'A normal customer','website_form','qualifying')", [leadId, dealer, id]);
    for (const selected of [id, otherId]) await pool.query("INSERT INTO enquiry_events(dealer_id,enquiry_id,kind,actor,summary,detail) VALUES($1,$2,'conversation_logged','dealer','A message','{\"message\":\"Customer conversation\"}')", [dealer, selected]);
    const beforeCustomer = (await pool.query('SELECT * FROM customers WHERE id=$1', [customerId])).rows;
    const beforeOther = (await pool.query('SELECT * FROM enquiries WHERE id=$1', [otherId])).rows;
    const result = await store.remove(dealer, id, 0, 'staff', true);
    assert.deepEqual(result, { deleted: true, id });
    assert.equal((await pool.query('SELECT id FROM enquiries WHERE id=$1', [id])).rows.length, 0);
    assert.equal((await pool.query('SELECT id FROM enquiry_events WHERE enquiry_id=$1', [id])).rows.length, 0);
    assert.deepEqual((await pool.query('SELECT * FROM customers WHERE id=$1', [customerId])).rows, beforeCustomer);
    assert.deepEqual((await pool.query('SELECT * FROM enquiries WHERE id=$1', [otherId])).rows, beforeOther);
    assert.equal((await pool.query('SELECT enquiry_id FROM leads WHERE id=$1', [leadId])).rows[0].enquiry_id, null);
    await assert.rejects(store.remove(dealer, id, 0, 'staff', true), /not found/);
  });
  await t.test('temporary QR grants and reply capabilities are revoked only for the selected thread', async () => {
    const id = await create(), otherId = await create(), grant = randomUUID(), otherGrant = randomUUID();
    for (const [grantId, selected] of [[grant, id], [otherGrant, otherId]]) await pool.query("INSERT INTO customer_phone_shares(id,dealer_id,request_id,token_hash,fingerprint,payload,created_by,expires_at)VALUES($1,$2,$3,$4,'fixture',$5::jsonb,'staff',now()+interval '1 day')", [grantId, dealer, randomUUID(), randomUUID(), JSON.stringify({ enquiryId: selected, message: 'Hello', files: [] })]);
    await pool.query('INSERT INTO enquiry_email_reply_routes(dealer_id,enquiry_id,send_key,reply_address,recipient) VALUES($1,$2,$3,$4,\'buyer@example.test\')', [dealer, id, randomUUID(), `${randomUUID()}@example.test`]);
    const untouched = (await pool.query('SELECT * FROM customer_phone_shares WHERE id=$1', [otherGrant])).rows;
    await store.remove(dealer, id, 0, 'staff', true);
    const revoked = (await pool.query('SELECT * FROM customer_phone_shares WHERE id=$1', [grant])).rows[0];
    assert.ok(revoked.revoked_at); assert.deepEqual(revoked.payload, {});
    assert.equal((await pool.query('SELECT id FROM enquiry_email_reply_routes WHERE enquiry_id=$1', [id])).rows.length, 0);
    assert.deepEqual((await pool.query('SELECT * FROM customer_phone_shares WHERE id=$1', [otherGrant])).rows, untouched);
  });
  await t.test('a database failure rolls back link revocation and enquiry deletion together', async () => {
    const id = await create(), grant = randomUUID();
    await pool.query("INSERT INTO customer_phone_shares(id,dealer_id,request_id,token_hash,fingerprint,payload,created_by,expires_at)VALUES($1,$2,$3,$4,'fixture',$5::jsonb,'staff',now()+interval '1 day')", [grant, dealer, randomUUID(), randomUUID(), JSON.stringify({ enquiryId: id, message: 'Keep on rollback', files: [] })]);
    const before = (await pool.query('SELECT * FROM customer_phone_shares WHERE id=$1', [grant])).rows;
    const failing = new EnquiryDeletionStore({ connect: async () => {
      const client = await pool.connect();
      return { release: client.release, query: async (sql: string, values?: any[]) => {
        if (sql.startsWith('DELETE FROM enquiries')) throw new Error('Injected storage failure');
        return client.query(sql, values);
      } };
    } }, { clock: () => now });
    await assert.rejects(failing.remove(dealer, id, 0, 'staff', true), /Injected storage failure/);
    assert.deepEqual((await pool.query('SELECT * FROM customer_phone_shares WHERE id=$1', [grant])).rows, before);
    assert.equal((await pool.query('SELECT id FROM enquiries WHERE id=$1', [id])).rows.length, 1);
  });
  await t.test('completed non-financial emails, reply text and photo records delete with only their enquiry', async () => {
    const id = await create(), route = randomUUID();
    await pool.query("INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,created_by)VALUES($1,$2,$3,$4,'hash','sent','buyer@example.test','Hello','Non-financial enquiry reply','staff')", [randomUUID(), dealer, id, randomUUID()]);
    await pool.query("INSERT INTO enquiry_email_reply_routes(id,dealer_id,enquiry_id,send_key,reply_address,recipient)VALUES($1,$2,$3,$4,$5,'buyer@example.test')", [route, dealer, id, randomUUID(), `${randomUUID()}@example.test`]);
    await pool.query("INSERT INTO enquiry_email_replies(provider_id,route_id,dealer_id,enquiry_id,status,message)VALUES($1,$2,$3,$4,'received','A customer reply')", [randomUUID(), route, dealer, id]);
    await pool.query("INSERT INTO enquiry_photos(id,dealer_id,enquiry_id,jpeg,byte_size,width,height,uploaded_by)VALUES($1,$2,$3,$4,12,1,1,'staff')", [randomUUID(), dealer, id, Buffer.alloc(12)]);
    await store.remove(dealer, id, 0, 'staff', true);
    for (const table of ['enquiry_emails', 'enquiry_email_reply_routes', 'enquiry_email_replies', 'enquiry_photos']) assert.equal((await pool.query(`SELECT id FROM ${table} WHERE enquiry_id=$1`, [id])).rows.length, 0, table);
  });
  await t.test('active bookings block deletion, while an explicitly cancelled appointment can be deleted', async () => {
    const id = await create({ type: 'viewing', appointment_at: new Date('2026-11-01T10:00:00Z'), appointment_status: 'confirmed' });
    await protectedEnquiry(id, /Cancel or complete/);
    await pool.query('UPDATE enquiries SET appointment_cancelled_at=now() WHERE id=$1', [id]);
    await store.remove(dealer, id, 0, 'staff', true);
  });
  await t.test('signed declarations remain protected even after a test drive is completed', async () => {
    const id = await create({ type: 'viewing', attendance: 'completed' }), vehicle = randomUUID();
    await pool.query("INSERT INTO vehicles(id,dealer_id,source,advert_id)VALUES($1,$2,'autotrader',$3)", [vehicle, dealer, randomUUID()]);
    await pool.query("INSERT INTO test_drive_declarations(dealer_id,enquiry_id,vehicle_id,request_id,token_hash,create_hash,appointment_revision,snapshot,context_hash,statement_version,statement,statement_hash,created_by,expires_at,signed_at,signer_name,acceptance_request_id,acceptance_hash)VALUES($1,$2,$3,$4,$5,'fixture',0,'{}','fixture','v1','Declaration','fixture','staff',now()+interval '1 day',now(),'Buyer',$6,'fixture')", [dealer, id, vehicle, randomUUID(), 'a'.repeat(64), randomUUID()]);
    await protectedEnquiry(id, /signed test-drive declaration/);
  });
  await t.test('sale, invoice and payment ledger remain byte-for-byte unchanged', async () => {
    const id = await create(), vehicle = randomUUID(), customer = randomUUID(), sale = randomUUID();
    await pool.query("INSERT INTO vehicles(id,dealer_id,source,advert_id) VALUES($1,$2,'autotrader',$3)", [vehicle, dealer, randomUUID()]);
    await pool.query("INSERT INTO customers(id,dealer_id,name) VALUES($1,$2,'Protected buyer')", [customer, dealer]);
    await pool.query('INSERT INTO sales(id,dealer_id,vehicle_id,customer_id,enquiry_id,agreed_price_pence,deposit_pence,balance_pence) VALUES($1,$2,$3,$4,$5,10000,1000,9000)', [sale, dealer, vehicle, customer, id]);
    await pool.query("INSERT INTO sale_payments(sale_id,kind,amount_pence,status) VALUES($1,'deposit',1000,'reversed')", [sale]);
    await pool.query("INSERT INTO invoices(sale_id,invoice_number,total_pence,deposit_pence,balance_pence,snapshot) VALUES($1,$2,10000,1000,9000,'{}')", [sale, `DELETE-INV-${randomUUID()}`]);
    const snapshot = () => Promise.all(['sales', 'sale_payments', 'invoices'].map(table => pool.query(`SELECT * FROM ${table} WHERE ${table === 'sales' ? 'id' : 'sale_id'}=$1`, [sale]).then(r => r.rows)));
    const before = await snapshot(); await protectedEnquiry(id, /sale, invoice, payment/); assert.deepEqual(await snapshot(), before);
  });
  await t.test('saved sale-workspace links and reservation/deposit leads block deletion', async () => {
    const id = await create();
    await pool.query("INSERT INTO sale_workspace(id,dealer_id,state,revision,reference) VALUES($1,$2,$3::jsonb,0,$4)", [randomUUID(), dealer, JSON.stringify({ draft: { sourceEnquiryId: id } }), randomUUID()]);
    await protectedEnquiry(id, /sale, invoice, payment/);
    const reserved = await create();
    await pool.query("INSERT INTO leads(id,dealer_id,enquiry_id,customer_name,source,stage) VALUES($1,$2,$3,'Buyer','website_form','reserved')", [randomUUID(), dealer, reserved]);
    await protectedEnquiry(reserved, /reservation or deposit/);
  });
  await t.test('historical online reservation and Stripe events protect zero-deposit leads in a plain stage', async () => {
    for (const kind of ['online_reservation', 'online_stripe_reservation', 'online_reservation_cancelled', 'stripe_reservation_activity']) {
      const id = await create(), lead = randomUUID();
      await pool.query("INSERT INTO leads(id,dealer_id,enquiry_id,customer_name,source,stage)VALUES($1,$2,$3,'Buyer','website_form','new')", [lead, dealer, id]);
      // The provider ledger lives in JSON, without a sales/payment-table FK.
      // Legacy completed/cancelled reservations can have no current deposit.
      await pool.query("INSERT INTO lead_events(lead_id,type,actor_type,payload)VALUES($1,'note_added','system',$2::jsonb)", [lead, JSON.stringify({ kind, reservation: { status: 'cancelled', paymentIntentId: 'fixture-provider-intent' } })]);
      const before = (await pool.query('SELECT * FROM lead_events WHERE lead_id=$1', [lead])).rows;
      await protectedEnquiry(id, /financial or reservation history/);
      assert.deepEqual((await pool.query('SELECT * FROM lead_events WHERE lead_id=$1', [lead])).rows, before);
      assert.equal((await pool.query('SELECT enquiry_id,deposit_pence,stage FROM leads WHERE id=$1', [lead])).rows[0].enquiry_id, id);
    }
  });
  await t.test('document attachments, sent financial emails and PDF shares are protected', async () => {
    const draft = await create();
    await pool.query("INSERT INTO enquiry_email_drafts(dealer_id,enquiry_id,content,updated_by) VALUES($1,$2,$3::jsonb,'staff')", [dealer, draft, JSON.stringify({ documentIds: ['invoice:fixture'] })]);
    await protectedEnquiry(draft, /financial document/);
    const sent = await create();
    await pool.query("INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,created_by,document_ids)VALUES($1,$2,$3,$4,'hash','sent','buyer@example.test','Invoice','Invoice','staff','[\"invoice:fixture\"]')", [randomUUID(), dealer, sent, randomUUID()]);
    await protectedEnquiry(sent, /invoice or payment emails/);
    const shared = await create();
    await pool.query("INSERT INTO customer_phone_shares(id,dealer_id,request_id,token_hash,fingerprint,payload,created_by,expires_at)VALUES($1,$2,$3,$4,'fixture',$5::jsonb,'staff',now()+interval '1 day')", [randomUUID(), dealer, randomUUID(), randomUUID(), JSON.stringify({ enquiryId: shared, files: [{ contentType: 'application/pdf' }] })]);
    await protectedEnquiry(shared, /financial document/);
  });
  await t.test('queued and uncertain email sends remain protected rather than erasing pending work', async () => {
    const id = await create();
    await pool.query("INSERT INTO email_outbox(dealer_id,enquiry_id,kind,send_key,payload_hash,validation_hash,validation,account_hash,retry_deadline)VALUES($1,$2,'staff',$3,'hash','hash','{}','fixture',now()+interval '1 day')", [dealer, id, randomUUID()]);
    await protectedEnquiry(id, /queued/);
  });
  await t.test('merged enquiries and inconsistent tenant links are protected', async () => {
    const parent = await create(), child = await create({ merged_into_id: parent });
    await protectedEnquiry(parent, /Merged/); await protectedEnquiry(child, /Merged/);
    const id = await create();
    await pool.query("INSERT INTO enquiry_events(dealer_id,enquiry_id,kind,summary)VALUES($1,$2,'enquiry_received','Inconsistent fixture')", [other, id]);
    await protectedEnquiry(id, /inconsistent dealership/);
  });
  await t.test('a legacy inconsistent email child blocks deletion before a database cascade can erase it', async () => {
    const id = await create();
    // Simulate a legacy database with an unvalidated composite FK. New writes
    // normally cannot create this state; deletion must also protect old rows.
    const constraint = (await pool.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='enquiry_emails'::regclass AND confrelid='enquiries'::regclass")).rows[0];
    assert.ok(constraint);
    await pool.query(`ALTER TABLE enquiry_emails DROP CONSTRAINT "${constraint.conname}"`);
    const email = randomUUID();
    try {
      await pool.query("INSERT INTO enquiry_emails(id,dealer_id,enquiry_id,request_id,request_hash,status,recipient,subject,message,created_by)VALUES($1,$2,$3,$4,'fixture','sent','different@example.test','Foreign thread','Must survive','staff')", [email, other, id, randomUUID()]);
      const before = (await pool.query('SELECT * FROM enquiry_emails WHERE id=$1', [email])).rows;
      await protectedEnquiry(id, /inconsistent dealership/);
      assert.deepEqual((await pool.query('SELECT * FROM enquiry_emails WHERE id=$1', [email])).rows, before);
    } finally {
      await pool.query('DELETE FROM enquiry_emails WHERE id=$1', [email]);
      await pool.query(`ALTER TABLE enquiry_emails ADD CONSTRAINT "${constraint.conname}" ${constraint.definition}`);
    }
  });
  await t.test('HTTP permissions, origin, legacy bypass, no-store and non-disclosure are enforced', async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => {
      req.log = pino({ level: 'silent' });
      const role = req.get('x-test-role');
      if (role) req.staff = { authUserId: 'http-staff', name: 'Staff', email: null, role: role as 'owner' | 'accounts' | 'salesperson' };
      else Object.assign(req, { auth: Object.assign(() => ({ userId: null }), { [Symbol.for('@clerk/express.auth')]: true }) });
      runWithTenant({ dealerId: dealer, canonicalOrigin: `https://${dealer}.example.test`, platform: 'autotrader', retailerId: 'fixture', sourceUrl: 'https://example.test', kind: 'website' }, next);
    });
    app.use('/api', enquiryDeletionRouter(store));
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const id = await create(), deletion = `/staff/enquiries/${id}/deletion`;
    const send = (path: string, method = 'GET', role?: string, body?: unknown, origin?: string) => fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}), ...(origin ? { origin } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    try {
      for (const method of ['GET', 'DELETE']) {
        assert.equal((await send(deletion, method)).status, 401);
        assert.equal((await send(deletion, method, 'accounts')).status, 403);
      }
      const inspected = await send(deletion, 'GET', 'salesperson');
      assert.equal(inspected.status, 200); assert.equal(inspected.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await inspected.json(), { id, expectedRevision: 0, canDelete: true, reason: null });
      for (const body of [{ expectedRevision: 0 }, { expectedRevision: 0, confirmDelete: false }, { expectedRevision: 0, confirmTestOnly: true }, { expectedRevision: -1, confirmDelete: true }, { expectedRevision: 0, confirmDelete: true, override: true }]) {
        assert.equal((await send(deletion, 'DELETE', 'owner', body)).status, 400);
      }
      assert.equal((await send(deletion, 'DELETE', 'owner', { expectedRevision: 1, confirmDelete: true })).status, 409);
      assert.equal((await send(deletion, 'DELETE', 'owner', { expectedRevision: 0, confirmDelete: true }, 'https://different.example.test')).status, 403);
      assert.equal((await send(deletion, 'DELETE', 'salesperson', { expectedRevision: 0, confirmDelete: true })).status, 200);
      assert.equal((await send(deletion, 'GET', 'owner')).status, 404);
      // There is no PIN feature or configuration endpoint to set up or bypass.
      for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await send('/staff/enquiry-deletion-pin', method, 'owner', method === 'GET' ? undefined : {})).status, 404);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  await engine.close();
});
