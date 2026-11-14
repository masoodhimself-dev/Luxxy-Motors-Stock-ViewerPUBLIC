import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { runWithTenant } from './lib/tenant-context';
import { createStockTaxRepository, stockTaxRowsQuery, stockTaxSummary } from './lib/stock-tax-checks';

const carA = '11111111-1111-4111-8111-111111111111';
const carB = '22222222-2222-4222-8222-222222222222';
const carC = '33333333-3333-4333-8333-333333333333';
const carD = '44444444-4444-4444-8444-444444444444';

test('the durable tax queue respects stock, dealer and registration changes through refresh and recovery', async () => {
  const engine = new PGlite();
  try {
    await engine.exec(`CREATE TABLE vehicles (
      id uuid PRIMARY KEY, dealer_id text NOT NULL, plate text, vrm text, registration text,
      source_status text NOT NULL DEFAULT 'live', archived_at timestamptz, inventory_status text NOT NULL DEFAULT 'available',
      UNIQUE(id,dealer_id)
    )`);
    await engine.exec(await readFile('../../lib/db/drizzle/0090_stock_tax_checks.sql', 'utf8'));
    const query = (sql: string, values?: unknown[]) => engine.query<any>(sql, values);
    const repo = createStockTaxRepository({ query, connect: async () => ({ query, release() {} }) }, () => true);
    await query(`INSERT INTO vehicles(id,dealer_id,plate,registration,inventory_status)
                 VALUES ($1,'one','listed in 2012','AB12 CDE','available'), ($2,'two',NULL,'AB12 CDE','reserved'),
                        ($3,'one','12 reg',NULL,'available'), ($4,'one',NULL,'EF56GHI','sold')`, [carA,carB,carC,carD]);

    assert.deepEqual((await repo.status('one')).current, { total:2, checked:0, pending:1, unavailable:0, missingRegistration:1 });
    const demoStatus = await runWithTenant({ dealerId: 'one', canonicalOrigin: 'https://demo.example.test', platform: 'cazoo', retailerId: '', sourceUrl: '', demo: true }, () => repo.status('one'));
    assert.equal(demoStatus.configured, false);
    assert.deepEqual(demoStatus.current, { total:2, checked:0, pending:0, unavailable:1, missingRegistration:1 });
    await repo.discover('one');
    await repo.discover('two');
    const jobA = await repo.claim(['one']);
    assert.equal(jobA?.vehicle_id, carA);
    assert.equal(jobA?.registration, 'AB12CDE');
    assert.equal(await repo.claim(['two']), undefined);
    const checkedAt = new Date().toISOString();
    await repo.finish(jobA!, { registration:'AB12CDE', checkedAt, taxStatus:'Untaxed', taxDueDate:'2026-11-12' }, null, 86400);
    const taxRows = (await query(stockTaxRowsQuery, ['one', [carA,carB]])).rows;
    assert.equal(taxRows.length, 1);
    assert.deepEqual(stockTaxSummary(taxRows[0],'AB12CDE',new Date()), { checkedAt, status:'Untaxed', dueDate:'2026-11-12' });
    assert.equal(stockTaxSummary(taxRows[0],'EF56GHI',new Date()), null);
    assert.equal(stockTaxSummary(taxRows[0],'AB12CDE',new Date(Date.parse(checkedAt)+86_400_000)), null);
    assert.deepEqual((await repo.status('one')).current, { total:2, checked:1, pending:0, unavailable:0, missingRegistration:1 });

    assert.equal(await repo.recordVehicleResult('one', carB, { registration:'AB12CDE', checkedAt, taxStatus:'Taxed' }), false);
    assert.equal(await repo.recordVehicleResult('one', carA, { registration:'EF56GHI', checkedAt, taxStatus:'Taxed' }), false);
    const jobB = await repo.claim(['two']);
    assert.equal(jobB?.vehicle_id, carB);
    await repo.finish(jobB!, { registration:'AB12CDE', checkedAt }, 'no_status', 86400);
    assert.deepEqual((await repo.status('two')).current, { total:1, checked:0, pending:0, unavailable:1, missingRegistration:0 });
    assert.equal(await repo.recordVehicleResult('two', carB, { registration:'AB12CDE', checkedAt, taxStatus:'SORN' }), true);
    assert.equal((await repo.status('two')).current.checked, 1);

    await repo.discover('one', true);
    assert.equal(await repo.claim(['one']), undefined);
    await query("UPDATE stock_tax_checks SET checked_at=now()-interval '16 minutes' WHERE vehicle_id=$1", [carA]);
    await repo.discover('one', true);
    assert.equal((await repo.status('one')).current.pending, 1);
    assert.equal((await query(stockTaxRowsQuery, ['one',[carA]])).rows[0].tax_status, 'Untaxed');
    await query('UPDATE vehicles SET registration=$2 WHERE id=$1', [carA,'EF56GHI']);
    assert.equal(await repo.claim(['one']), undefined);
    await repo.discover('one');
    const recovered = await repo.claim(['one']);
    assert.equal(recovered?.registration, 'EF56GHI');
    await query("UPDATE stock_tax_checks SET lease_until=now()-interval '1 second' WHERE vehicle_id=$1", [carA]);
    const retry = await repo.claim(['one']);
    assert.notEqual(retry?.lease_token,recovered?.lease_token);
    await repo.finish(recovered!, { registration:'EF56GHI', checkedAt, taxStatus:'Untaxed' }, null, 86400);
    await repo.finish(retry!, { registration:'EF56GHI', checkedAt, taxStatus:'Taxed' }, null, 86400);
    assert.equal((await query(stockTaxRowsQuery, ['one',[carA]])).rows[0].tax_status, 'Taxed');
  } finally {
    await engine.close();
  }
});
