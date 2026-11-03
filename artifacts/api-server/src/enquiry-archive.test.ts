import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { engine, pool } from './test/tenant-test-db';
import { EnquiryArchiveStore, enquiryAiStates, purgeArchivedEnquiries, archiveEnquiryInput } from './lib/enquiry-archive';
import { EnquiryDeletionStore } from './lib/enquiry-deletion';
import { ArchiveEnquiryBody, RestoreEnquiryBody } from '../../../lib/api-zod/src/generated/api';

const dealer = 'archive-dealer-a', other = 'archive-dealer-b';
const start = new Date('2026-11-03T12:00:00Z');
let now = start;
const archive = new EnquiryArchiveStore(pool, () => now);
test.after(() => engine.close());
test('archive preserves enquiries for 30 days and never bypasses protected deletion', async t => {
  for (const file of (await readdir('../../lib/db/drizzle')).filter(name => /^\d+.*\.sql$/.test(name)).sort()) await engine.exec(await readFile(join('../../lib/db/drizzle', file), 'utf8'));
  for (const id of [dealer, other]) await pool.query("INSERT INTO dealerships(id,name,status,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,$1,'active',$2,'autotrader','fixture','https://www.autotrader.co.uk/fixture')", [id, `https://${id}.example.test`]);
  const create = async (changes: Record<string, unknown> = {}) => {
    const record = { id: randomUUID(), dealer_id: dealer, customer_name: 'Fictional buyer', message: 'Please check this car', email: 'buyer@example.test', type: 'general', ...changes };
    const columns = Object.keys(record);
    await pool.query(`INSERT INTO enquiries(${columns.join(',')}) VALUES(${columns.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(record));
    return String(record.id);
  };
  const read = async (id: string) => (await pool.query('SELECT * FROM enquiries WHERE id=$1', [id])).rows[0];
  await t.test('strict revisions, tenant scope and input contracts protect archive and restore', async () => {
    for (const schema of [ArchiveEnquiryBody, RestoreEnquiryBody, archiveEnquiryInput]) {
      assert.equal(schema.safeParse({ expectedRevision: 0 }).success, true);
      for (const value of [{}, { expectedRevision: -1 }, { expectedRevision: 1.2 }]) assert.equal(schema.safeParse(value).success, false);
    }
    assert.equal(archiveEnquiryInput.safeParse({ expectedRevision: 0, permanent: true }).success, false);
    const id = await create({ workspace_revision: 2 });
    const before = await read(id);
    await assert.rejects(archive.change(other, id, 2, true), /not found/);
    await assert.rejects(archive.change(dealer, id, 1, true), /changed/);
    assert.deepEqual(await read(id), before);
  });
  await t.test('archive keeps conversation and draft, increments revision, restore preserves status and resets retention', async () => {
    const id = await create({ status: 'contacted' });
    await pool.query("INSERT INTO enquiry_events(dealer_id,enquiry_id,kind,summary)VALUES($1,$2,'conversation_logged','Retain this conversation')", [dealer, id]);
    await pool.query("INSERT INTO enquiry_email_drafts(dealer_id,enquiry_id,content,updated_by)VALUES($1,$2,'{\"message\":\"Keep this draft\"}','staff')", [dealer, id]);
    const first = await archive.change(dealer, id, 0, true);
    assert.equal(new Date(first.archived_at).toISOString(), start.toISOString());
    assert.equal(new Date(first.archive_delete_at).toISOString(), '2026-12-03T12:00:00.000Z');
    assert.equal(first.archive_hold_reason, null); assert.equal(first.workspace_revision, 1);
    await assert.rejects(archive.change(dealer, id, 0, false), /changed/);
    const restored = await archive.change(dealer, id, 1, false);
    assert.equal(restored.archived_at, null); assert.equal(restored.archive_delete_at, null); assert.equal(restored.status, 'contacted'); assert.equal(restored.workspace_revision, 2);
    assert.equal((await pool.query('SELECT count(*) AS count FROM enquiry_events WHERE enquiry_id=$1', [id])).rows[0].count, 1);
    assert.equal((await pool.query('SELECT content FROM enquiry_email_drafts WHERE enquiry_id=$1', [id])).rows[0].content.message, 'Keep this draft');
  });
  await t.test('merged originals and parent cannot be archived as if they were an independent case', async () => {
    const parent = await create(), child = await create({ merged_into_id: parent });
    for (const id of [parent, child]) { await assert.rejects(archive.change(dealer, id, 0, true), /Merged/); assert.equal((await read(id)).archived_at, null); }
  });
  await t.test('active queued/sending/unknown mail prevents archive rather than racing the provider', async () => {
    const id = await create();
    for (const status of ['queued', 'sending', 'unknown']) {
      await pool.query("INSERT INTO email_outbox(dealer_id,enquiry_id,kind,send_key,payload_hash,validation_hash,validation,account_hash,retry_deadline,status)VALUES($1,$2,'staff',$3,'fixture','fixture','{}','fixture',now()+interval '1 day',$4)", [dealer, id, randomUUID(), status]);
      await assert.rejects(archive.change(dealer, id, 0, true), /queued or being processed/);
      assert.equal((await read(id)).archived_at, null);
      await pool.query('DELETE FROM email_outbox WHERE enquiry_id=$1', [id]);
    }
  });
  await t.test('ordinary cases cannot purge early and recoverable cases restore before the deadline', async () => {
    const id = await create(); await archive.change(dealer, id, 0, true);
    const deletion = new EnquiryDeletionStore(pool, { clock: () => new Date('2026-12-03T11:59:59Z') });
    assert.equal((await deletion.purgeArchived(dealer, id)).deleted, false);
    assert.ok(await read(id));
    await archive.change(dealer, id, 1, false);
    assert.equal((await new EnquiryDeletionStore(pool, { clock: () => new Date('2026-12-04T12:00:00Z') }).purgeArchived(dealer, id)).deleted, false);
  });
  await t.test('after 30 days ordinary conversation data expires but safe AI cost accounting survives', async () => {
    const id = await create(); await archive.change(dealer, id, 0, true);
    await pool.query("INSERT INTO ai_assistance_requests(id,dealer_id,session_hash,ip_hash,request_id,request_hash,month_key,cost_micro_usd,status,result,context_audit)VALUES($1,$2,'fixture','fixture',$3,'fixture','2026-11',125,'succeeded','{\"answer\":\"Private generated answer\"}',$4::jsonb)", [randomUUID(), dealer, randomUUID(), JSON.stringify({ version: 1, enquiryId: id, checks: [] })]);
    const result = await new EnquiryDeletionStore(pool, { clock: () => new Date('2026-12-03T12:00:00Z') }).purgeArchived(dealer, id);
    assert.equal(result.deleted, true); assert.equal(await read(id), undefined);
    const accounting = (await pool.query("SELECT result,context_audit,cost_micro_usd FROM ai_assistance_requests WHERE dealer_id=$1 AND request_hash='fixture'", [dealer])).rows[0];
    assert.equal(accounting.result, null); assert.equal(accounting.context_audit, null); assert.equal(accounting.cost_micro_usd, 125);
  });
  await t.test('financial history stays intact behind an archive retention hold', async () => {
    const id = await create(), vehicle = randomUUID(), customer = randomUUID(), sale = randomUUID();
    await pool.query("INSERT INTO vehicles(id,dealer_id,source,advert_id)VALUES($1,$2,'autotrader',$3)", [vehicle, dealer, randomUUID()]);
    await pool.query("INSERT INTO customers(id,dealer_id,name)VALUES($1,$2,'Fictional buyer')", [customer, dealer]);
    await pool.query('INSERT INTO sales(id,dealer_id,vehicle_id,customer_id,enquiry_id,agreed_price_pence,deposit_pence,balance_pence)VALUES($1,$2,$3,$4,$5,10000,1000,9000)', [sale, dealer, vehicle, customer, id]);
    await pool.query("INSERT INTO sale_payments(sale_id,kind,amount_pence,status)VALUES($1,'deposit',1000,'confirmed')", [sale]);
    await pool.query("INSERT INTO invoices(sale_id,invoice_number,total_pence,deposit_pence,balance_pence,snapshot)VALUES($1,$2,10000,1000,9000,'{}')", [sale, randomUUID()]);
    const snapshot = () => Promise.all(['sales','invoices','sale_payments'].map(table => pool.query(`SELECT * FROM ${table} WHERE ${table === 'sales' ? 'id' : 'sale_id'}=$1`, [sale]).then(result => result.rows)));
    const before = await snapshot();
    assert.match((await archive.change(dealer, id, 0, true)).archive_hold_reason, /sale, invoice, payment/);
    const result = await new EnquiryDeletionStore(pool, { clock: () => new Date('2026-12-04T12:00:00Z') }).purgeArchived(dealer, id);
    assert.equal(result.deleted, false); assert.equal(result.held, true); assert.deepEqual(await snapshot(), before);
    assert.ok((await read(id)).archived_at);
  });
  await t.test('active visits must be completed or cancelled before archiving; legacy archived visits remain protected', async () => {
    const id = await create({ type: 'viewing', appointment_at: new Date('2026-12-20T10:00:00Z'), appointment_status: 'confirmed' });
    for (const attendance of ['scheduled', 'arrived']) {
      await pool.query('UPDATE enquiries SET attendance=$2 WHERE id=$1', [id, attendance]);
      await assert.rejects(archive.change(dealer, id, 0, true), /Cancel or complete/);
      assert.equal((await read(id)).archived_at, null);
    }
    await pool.query('UPDATE enquiries SET archived_at=$2,archive_delete_at=$3 WHERE id=$1', [id, start, new Date('2026-12-03T12:00:00Z')]);
    const result = await new EnquiryDeletionStore(pool, { clock: () => new Date('2026-12-04T12:00:00Z') }).purgeArchived(dealer, id);
    assert.equal(result.held, true); assert.ok(await read(id));
  });
  await t.test('AI classification needs an actual automation receipt and stays tenant scoped', async () => {
    const ordinary = await create({ source: 'cazoo' }), automated = await create(), skipped = await create();
    await pool.query("INSERT INTO enquiry_email_drafts(dealer_id,enquiry_id,source,content,updated_by)VALUES($1,$2,'ai','{}','staff')", [dealer, ordinary]);
    for (const [id, status] of [[automated, 'ready'], [skipped, 'skipped']]) await pool.query("INSERT INTO cazoo_lead_receipts(provider_id,dealer_id,mailbox,status,enquiry_id,draft_status)VALUES($1,$2,'fixture@example.test','imported',$3,$4)", [randomUUID(), dealer, id, status]);
    const states = await enquiryAiStates(dealer, [ordinary, automated, skipped], pool);
    assert.equal(states.has(ordinary), false); assert.equal(states.has(skipped), false);
    assert.deepEqual(states.get(automated), { aiProvider: 'cazoo', aiDraftStatus: 'ready' });
    assert.equal((await enquiryAiStates(other, [automated], pool)).size, 0);
  });
  await t.test('bounded retention safely reports holds instead of deleting protected records', async () => {
    const counts = await purgeArchivedEnquiries(dealer, new Date('2026-12-06T12:00:00Z'), pool);
    assert.ok(counts.held >= 2);
    assert.equal((await purgeArchivedEnquiries(dealer, new Date('2026-12-06T12:01:00Z'), pool)).held, 0);
  });
});
