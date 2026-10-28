import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrations = new URL('../../../lib/db/drizzle/', import.meta.url);
const journal = JSON.parse(await readFile(new URL('meta/_journal.json', migrations), 'utf8'));
const retirement = await readFile(new URL('0071_remove_practice_mode.sql', migrations), 'utf8');
const database = new PGlite();
for (const entry of journal.entries.filter((entry: { idx: number }) => entry.idx < 71)) {
  const sql = await readFile(new URL(`${entry.tag}.sql`, migrations), 'utf8');
  await database.exec(sql);
}

const id = '00000000-0000-4000-8000-000000000071';
const car = '00000000-0000-4000-8000-000000000072';
const sandbox = '__sales_test__00000000-0000-4000-8000-000000000073';
const saleId = '00000000-0000-4000-8000-000000000074';
async function seed() {
  await database.query(`INSERT INTO sales_test_sessions(id,parent_dealer_id,staff_user_id,sandbox_dealer_id,vehicle_id,customer_name,expires_at) VALUES($1,'real-dealer','staff',$2,$3,'Copied Buyer',now()+interval '1 hour')`, [id,sandbox,car]);
  await database.query(`INSERT INTO vehicles(id,dealer_id,source,advert_id,title,inventory_status) VALUES($1,$2,'isolated-test',$3,'Copied Car','available')`, [car,sandbox,id]);
  await database.query(`INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES($1,$2,'TEST-1',1,$3::jsonb)`, [saleId,sandbox,JSON.stringify({id:saleId,draft:{vehicleId:car,customer:'Copied Buyer'},documents:[{number:'TEST-1'}],payments:[{amountPence:10000}]})]);
  await database.query(`INSERT INTO sale_workspace_counters(dealer_id,numbers) VALUES($1,'{"invoice":1}')`, [sandbox]);
}
async function transaction(run: () => Promise<void>) {
  await database.exec('BEGIN');
  try { await run(); } finally { await database.exec('ROLLBACK'); }
}

test('practice retirement removes isolated copies and leaves real stock, customers, enquiries and invoice/payment snapshots identical', async () => {
  await transaction(async () => {
    await seed();
    await database.exec(`INSERT INTO vehicles(dealer_id,source,advert_id,title,source_price) VALUES('real-dealer','cazoo','real-car','Real Car',12000);
      INSERT INTO customers(dealer_id,name,email) VALUES('real-dealer','Real Buyer','buyer@example.test');
      INSERT INTO enquiries(dealer_id,type,customer_name,message) VALUES('real-dealer','general','Real Buyer','Keep this enquiry');
      INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES('00000000-0000-4000-8000-000000000075','real-dealer','INV-1',4,'{"draft":{"customer":"Real Buyer"},"documents":[{"number":"INV-1","archive":"original bytes"}],"payments":[{"amountPence":1200000}]}');`);
    const capture = async () => Promise.all(['vehicles','customers','enquiries','sale_workspace'].map(async table => (await database.query(`SELECT * FROM ${table} WHERE dealer_id='real-dealer' ORDER BY id`)).rows));
    const before = await capture();
    await database.exec(retirement);
    assert.deepEqual(await capture(), before);
    assert.equal((await database.query<{count:number}>('SELECT count(*)::int AS count FROM vehicles WHERE dealer_id=$1',[sandbox])).rows[0].count,0);
    assert.equal((await database.query<{count:number}>('SELECT count(*)::int AS count FROM sale_workspace WHERE dealer_id=$1',[sandbox])).rows[0].count,0);
    assert.equal((await database.query<{count:number}>('SELECT count(*)::int AS count FROM sale_workspace_counters WHERE dealer_id=$1',[sandbox])).rows[0].count,0);
    const tables=(await database.query<{table_name:string}>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map(row=>row.table_name);
    assert.ok(!tables.some(name=>name.startsWith('sales_test_')||name==='test_email_settings'));
  });
});

test('practice retirement refuses a namespace that is a real dealership', async () => {
  await transaction(async () => {
    await seed();
    await database.query(`INSERT INTO dealerships(id,name,canonical_origin,stock_platform,retailer_id,source_url) VALUES($1,'Protected dealer','https://dealer.example.test','cazoo','75497','https://example.test')`,[sandbox]);
    await assert.rejects(database.exec(retirement),/namespace isolation/);
  });
});

test('practice retirement refuses foreign customer activity instead of following cascading vehicle links', async () => {
  await transaction(async () => {
    await seed();
    await database.query(`INSERT INTO enquiries(dealer_id,vehicle_id,type,customer_name,message) VALUES('real-dealer',$1,'general','Protected Buyer','Keep this enquiry')`,[car]);
    await assert.rejects(database.exec(retirement),/linked vehicle activity/);
  });
});

test('practice retirement refuses live sale references to a copied vehicle', async () => {
  await transaction(async () => {
    await seed();
    await database.query(`INSERT INTO sale_workspace(id,dealer_id,reference,revision,state) VALUES('00000000-0000-4000-8000-000000000075','real-dealer','INV-1',1,$1::jsonb)`,[JSON.stringify({draft:{vehicleId:car}})]);
    await assert.rejects(database.exec(retirement),/unexpected vehicle or sale link/);
  });
});

test('practice retirement refuses unexpected dealership data even without a vehicle link', async () => {
  await transaction(async () => {
    await seed();
    await database.query(`INSERT INTO customers(dealer_id,name) VALUES($1,'Protected Buyer')`,[sandbox]);
    await assert.rejects(database.exec(retirement),/unexpected dealership data/);
  });
});

test.after(async () => { await database.close(); });
