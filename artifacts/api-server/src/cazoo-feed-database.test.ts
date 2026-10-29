import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { CAZOO_CSV_COLUMNS } from './lib/cazoo-csv';
import { createCazooFeedCollector, createPostgresCazooFeedRepository, type CazooFeedCheck } from './lib/cazoo-feed-collector';
import type { CazooSftpConfig } from './lib/cazoo-sftp';

// No production database, .env, provider or real account is used. The real
// migration and repository SQL run in PGlite. Only PostgreSQL session advisory
// locks (not implemented by PGlite) are substituted by this pool adapter.
const config: CazooSftpConfig = {
  dealerId: 'database-fixture-choice', retailerId: 'cazoo-75497', feedId: 'AETA22820',
  dealerName: 'Fixture Choice Motors', host: 'u123-sub2.your-storagebox.de', port: 22,
  username: 'u123-sub2', remotePath: '/cazoo.csv', passwordEnv: 'CAZOO_SFTP_PASSWORD_FIXTURE',
  hostFingerprint: 'SHA256:' + 'A'.repeat(43),
};
const otherDealer = 'database-fixture-other';
const firstId = '00000000-0000-4000-8000-000000000001';
const photo = 'https://cdn.images.autoexposure.co.uk/AETA22820/AETV12345678_1.jpg?t=observed';
const protectedTables = ['dealerships', 'vehicles', 'vehicle_images', 'customers', 'enquiries', 'test_drive_bookings', 'sales', 'invoices', 'sale_payments', 'sale_fulfilments'];
type StoredCheck = {
  id: string;
  attempts: number;
  next_attempt_at: Date | null;
  candidate: CazooFeedCheck['candidate'];
  reconciliation: CazooFeedCheck['reconciliation'];
  error_code: string | null;
};

function csv(registration = 'AB12CDE') {
  const row: Record<string, string> = {
    Feed_ID: config.feedId, Vehicle_ID: 'AETV12345678', FullRegistration: registration,
    Colour: 'Grey', FuelType: 'Petrol', Year: '2018', Mileage: '55000', Bodytype: 'HATCHBACK',
    Doors: '5', Make: 'Volkswagen', Model: 'Golf', Variant: '1.5 TSI', EngineSize: '1498',
    Price: '7990', Transmission: 'Automatic', PictureRefs: photo, Options: 'Official fixture description.',
    New: 'N', Used: 'Y', V5: 'N', ExDemo: 'N', FranchisedApproved: 'N', DID: '75497',
  };
  return Buffer.from(CAZOO_CSV_COLUMNS.join(',') + '\r\n' + CAZOO_CSV_COLUMNS.map(key => row[key] ?? '').join(',') + '\r\n');
}

async function fixture() {
  const engine = new PGlite();
  await engine.exec(`
    CREATE TABLE dealerships (id text PRIMARY KEY,status text NOT NULL,stock_platform text NOT NULL,retailer_id text NOT NULL,stock_import_enabled boolean NOT NULL DEFAULT false);
    CREATE TABLE vehicles (
      id uuid PRIMARY KEY,dealer_id text NOT NULL REFERENCES dealerships(id),source text,advert_id text,
      inventory_status text,source_status text,archived_at timestamptz,make text,model text,year integer,
      registration text,plate text,vrm text,source_hero_image text,source_price integer,
      website_price_override integer,website_title_override text,website_description text,website_hero_image_override text,
      audit_metadata jsonb NOT NULL DEFAULT '{}',raw_source_data jsonb NOT NULL DEFAULT '{}'
    );
    CREATE TABLE vehicle_images (id uuid PRIMARY KEY,vehicle_id uuid NOT NULL REFERENCES vehicles(id),source_url text,origin text,is_active boolean,sort_order integer);
    ${protectedTables.slice(3).map(name => `CREATE TABLE ${name} (id uuid PRIMARY KEY,dealer_id text NOT NULL REFERENCES dealerships(id),payload jsonb NOT NULL);`).join('\n')}
  `);
  const migration = await readFile(path.resolve(process.cwd(), '../../lib/db/drizzle/0075_cazoo_feed_checks.sql'), 'utf8');
  await engine.exec(migration);
  // Applying the migration twice must also be safe for an already prepared DB.
  await engine.exec(migration);
  for (const dealer of [config.dealerId, otherDealer]) {
    await engine.query('INSERT INTO dealerships(id,status,stock_platform,retailer_id) VALUES($1,$2,$3,$4)', [dealer, 'active', 'cazoo', config.retailerId]);
  }
  const statuses = ['reserved', 'sold', 'hidden', 'archived', 'available'];
  for (let index = 0; index < statuses.length; index++) {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    await engine.query(`INSERT INTO vehicles(id,dealer_id,source,advert_id,inventory_status,source_status,make,model,year,plate,source_hero_image,source_price,website_price_override,website_description,audit_metadata)
      VALUES($1,$2,'cazoo',$3,$4,$5,$6,$7,2018,$8,$9,8990,9990,'Staff retained description',$10::jsonb)`,
    [id, config.dealerId, index === 0 ? '80238245' : `existing-${index}`, statuses[index], index === 4 ? 'missing' : 'live', index === 0 ? 'Volkswagen' : 'Fixture', index === 0 ? 'Golf' : `Other ${index}`, index === 0 ? 'AB12CDE' : null, index === 0 ? photo : null, JSON.stringify({ booking: 'keep', saleReservation: 'keep' })]);
  }
  for (const [dealer, source, id] of [
    [otherDealer, 'cazoo', '00000000-0000-4000-8000-000000000099'],
    [config.dealerId, 'autotrader', '00000000-0000-4000-8000-000000000098'],
  ]) {
    await engine.query('INSERT INTO vehicles(id,dealer_id,source,advert_id,inventory_status,make,model,year) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [id, dealer, source, 'foreign-source-record', 'available', 'Volkswagen', 'Golf', 2018]);
    await engine.query("INSERT INTO vehicle_images VALUES($1,$2,$3,'source',true,0)", [randomUUID(), id, photo]);
  }
  await engine.query("INSERT INTO vehicle_images VALUES($1,$2,$3,'source',false,0)", [randomUUID(), firstId, photo]);
  await engine.query("INSERT INTO vehicle_images VALUES($1,$2,$3,'manual',true,1)", [randomUUID(), firstId, 'https://images.example.test/manual.jpg']);
  for (const name of protectedTables.slice(3)) {
    for (const dealer of [config.dealerId, otherDealer]) {
      await engine.query(`INSERT INTO ${name}(id,dealer_id,payload) VALUES($1,$2,$3::jsonb)`, [randomUUID(), dealer, JSON.stringify({ amount: 10000, vehicleId: firstId, immutable: name, customer: 'fixture only' })]);
    }
  }
  const locks = new Map<string, symbol>();
  const sqlCalls: string[] = [];
  let released = 0;
  const pool = {
    async connect() {
      const owner = Symbol('test PostgreSQL session');
      return {
        async query(query: string, values?: unknown[]) {
          sqlCalls.push(query);
          if (query === 'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked') {
            const key = String(values?.[0]), acquired = !locks.has(key);
            if (acquired) locks.set(key, owner);
            return { rows: [{ locked: acquired }] };
          }
          if (query === 'SELECT pg_advisory_unlock(hashtextextended($1,0))') {
            const key = String(values?.[0]);
            assert.equal(locks.get(key), owner, 'only the owning database session may release its lease');
            locks.delete(key);
            return { rows: [{ pg_advisory_unlock: true }] };
          }
          return engine.query<Record<string, any>>(query, values);
        },
        release() { released++; },
      };
    },
  };
  const repository = await createPostgresCazooFeedRepository(pool);
  async function protectedSnapshot() {
    const result: Record<string, unknown> = {};
    for (const table of protectedTables) result[table] = (await engine.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    return result;
  }
  return { engine, repository, locks, sqlCalls, protectedSnapshot, released: () => released };
}

function blankCheck(dealerId = config.dealerId, slotKey = 'manual:schema'): CazooFeedCheck {
  return {
    id: randomUUID(), dealerId, slotKey, status: 'processing', attempts: 1,
    receivedAt: '2026-10-29T07:10:00.000Z', completedAt: null, nextAttemptAt: null,
    fileHash: null, fileBytes: null, remoteModifiedAt: null, vehicleCount: null,
    basedOnCheckId: null, candidate: null, reconciliation: null, warnings: [], errorCode: null, errorMessage: null,
  };
}

test('actual migration enforces tenant references, statuses, counts, hashes and per-dealer slot uniqueness', async () => {
  const h = await fixture();
  try {
    for (const [column, value] of [['dealer_id', 'missing-dealer'], ['status', 'published'], ['attempts', 4], ['file_hash', 'not-a-hash'], ['vehicle_count', -1], ['file_bytes', -1]] as const) {
      await assert.rejects(h.engine.query(`INSERT INTO cazoo_feed_checks(dealer_id,slot_key,status,received_at,${column === 'dealer_id' || column === 'status' ? 'warnings' : column}) VALUES($1,$2,$3,$4,$5)`,
        [column === 'dealer_id' ? value : config.dealerId, 'manual:invalid', column === 'status' ? value : 'processing', '2026-10-29T07:10:00Z', column === 'dealer_id' || column === 'status' ? '[]' : value]));
    }
    const save = async (check: CazooFeedCheck) => h.repository.withDealerLock(check.dealerId, lease => lease.save(check));
    const original = blankCheck();
    await save(original);
    await save({ ...original, status: 'failed', attempts: 2, errorCode: 'fixture_failure' });
    const rows = (await h.engine.query<StoredCheck>('SELECT * FROM cazoo_feed_checks')).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].id, original.id); assert.equal(rows[0].attempts, 2);
    await save(blankCheck(otherDealer));
    assert.equal((await h.engine.query('SELECT * FROM cazoo_feed_checks')).rows.length, 2);
    await assert.rejects(h.engine.query('INSERT INTO cazoo_feed_checks(dealer_id,slot_key,status,received_at) VALUES($1,$2,$3,$4)', [config.dealerId, original.slotKey, 'processing', original.receivedAt]));
  } finally { await h.engine.close(); }
});

test('real repository inventory SQL includes protected statuses and inactive photos but excludes other dealerships and sources', async () => {
  const h = await fixture();
  try {
    const result = await h.repository.withDealerLock(config.dealerId, async lease => ({ dealer: await lease.getDealer(), inventory: await lease.inventory() }));
    assert.equal(result.value?.dealer?.id, config.dealerId);
    const inventory = result.value!.inventory;
    assert.equal(inventory.length, 5);
    assert.deepEqual(inventory.map(car => car.inventoryStatus).sort(), ['archived', 'available', 'hidden', 'reserved', 'sold']);
    assert.ok(inventory.every(car => car.dealerId === config.dealerId && car.source === 'cazoo'));
    const car = inventory.find(car => car.id === firstId)!;
    assert.equal(car.websitePriceOverride, 9990);
    assert.deepEqual(car.images?.map(image => [image.origin, image.isActive]), [['source', false], ['manual', true]]);
    assert.deepEqual(car.auditMetadata, { booking: 'keep', saleReservation: 'keep' });
  } finally { await h.engine.close(); }
});

test('collection executes production candidate SQL, survives restart and leaves protected records byte-for-byte equivalent', async () => {
  const h = await fixture();
  try {
    const before = await h.protectedSnapshot();
    let at = new Date('2026-10-29T07:10:00Z'), transfers = 0, modifiedAt = '2026-10-29T07:00:00Z';
    const bytes = csv(), sha256 = createHash('sha256').update(bytes).digest('hex');
    const dependencies = { repository: h.repository, now: () => new Date(at), readPassword: () => 'fixture-secret-not-saved', readFile: async () => { transfers++; return { bytes, sha256, size: bytes.length, modifiedAt }; } };
    const first = await createCazooFeedCollector(dependencies).tick([config]);
    assert.equal(first[0].value?.check.status, 'ready');
    assert.equal(first[0].value?.check.reconciliation?.matches[0].vehicleId, firstId);
    assert.equal(first[0].value?.check.reconciliation?.matches[0].preserveInventoryStatus, 'reserved');
    const id = first[0].value!.check.id;
    at = new Date('2026-10-29T07:20:00Z');
    // A fresh collector over the same real repository reads the durable slot.
    const skipped = await createCazooFeedCollector(dependencies).tick([config]);
    assert.equal(skipped[0].value?.outcome, 'skipped'); assert.equal(transfers, 1);
    at = new Date('2026-10-29T19:10:00Z');
    modifiedAt = '2026-10-29T19:00:00Z'; // A new delivery can legitimately contain identical bytes.
    const unchanged = await createCazooFeedCollector(dependencies).tick([config]);
    assert.equal(unchanged[0].value?.check.status, 'unchanged');
    assert.equal(unchanged[0].value?.check.basedOnCheckId, id);
    assert.equal(unchanged[0].value?.check.candidate, null);
    assert.equal(transfers, 2);
    const rows = (await h.engine.query<StoredCheck>('SELECT * FROM cazoo_feed_checks ORDER BY received_at')).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows[0].candidate);
    assert.ok(rows[0].reconciliation?.candidateCars);
    assert.equal(rows[0].candidate.metadata.feedId, config.feedId);
    assert.equal(rows[0].candidate.cars[0].sourceExtras.description, 'Official fixture description.');
    assert.equal(rows[0].reconciliation.candidateCars[0].advertId, '80238245');
    assert.ok(!JSON.stringify(rows).includes('fixture-secret-not-saved'));
    assert.deepEqual(await h.protectedSnapshot(), before);
    assert.equal(h.locks.size, 0);
    assert.ok(h.sqlCalls.filter(query => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(query)).every(query => /^INSERT INTO cazoo_feed_checks\b/.test(query)));
  } finally { await h.engine.close(); }
});

test('failed scheduled retries persist their attempt budget across collectors without replacing the last ready file', async () => {
  const h = await fixture();
  try {
    const before = await h.protectedSnapshot();
    let at = new Date('2026-10-29T07:10:00Z'), fail = false, transfers = 0;
    const bytes = csv();
    const dependencies = { repository: h.repository, now: () => new Date(at), readPassword: () => 'fixture-secret', readFile: async () => { transfers++; if (fail) throw Error('private provider fixture-secret diagnostic'); return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, modifiedAt: '2026-10-29T07:00:00Z' }; } };
    const success = await createCazooFeedCollector(dependencies).tick([config]);
    fail = true;
    for (const time of ['19:10', '19:20', '19:25', '19:40', '20:00']) {
      at = new Date(`2026-10-29T${time}:00Z`);
      await createCazooFeedCollector(dependencies).tick([config]);
    }
    assert.equal(transfers, 4, 'one successful file plus only three retry attempts');
    const failed = (await h.engine.query<StoredCheck>("SELECT * FROM cazoo_feed_checks WHERE status='failed'")).rows[0];
    assert.equal(failed.attempts, 3); assert.equal(failed.next_attempt_at, null);
    assert.equal(failed.candidate, null); assert.equal(failed.error_code, 'collection_unavailable');
    assert.ok(!JSON.stringify(failed).includes('fixture-secret'));
    const latest = await h.repository.withDealerLock(config.dealerId, lease => lease.latestReadyFile());
    assert.equal(latest.value?.id, success[0].value?.check.id);
    assert.deepEqual(await h.protectedSnapshot(), before);
  } finally { await h.engine.close(); }
});

test('a previous-slot file remains retryable until the delayed current delivery arrives, even with identical bytes', async () => {
  const h = await fixture();
  try {
    const before = await h.protectedSnapshot(), bytes = csv();
    let at = new Date('2026-10-29T07:10:00Z'), modifiedAt = '2026-10-29T07:00:00Z', transfers = 0;
    const dependencies = { repository: h.repository, now: () => new Date(at), readPassword: () => 'fixture-secret', readFile: async () => { transfers++; return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, modifiedAt }; } };
    const morning = await createCazooFeedCollector(dependencies).tick([config]);
    assert.equal(morning[0].value?.check.status, 'ready');
    at = new Date('2026-10-29T19:10:00Z');
    const waiting = await createCazooFeedCollector(dependencies).tick([config]);
    assert.equal(waiting[0].value?.check.status, 'failed', 'the morning file is not proof of an unchanged evening delivery');
    assert.ok(waiting[0].value?.check.nextAttemptAt, 'a late upload must leave the current slot retryable');
    at = new Date('2026-10-29T19:20:00Z');
    await createCazooFeedCollector(dependencies).tick([config]);
    assert.equal(transfers, 2, 'respect the durable retry deadline while waiting');
    at = new Date('2026-10-29T19:30:00Z'); modifiedAt = '2026-10-29T19:05:00Z';
    const delivered = await createCazooFeedCollector(dependencies).tick([config]);
    assert.equal(delivered[0].value?.check.status, 'unchanged');
    assert.equal(delivered[0].value?.check.attempts, 2);
    assert.equal(delivered[0].value?.check.basedOnCheckId, morning[0].value?.check.id);
    assert.equal(transfers, 3);
    assert.deepEqual(await h.protectedSnapshot(), before);
  } finally { await h.engine.close(); }
});

test('identity conflicts persist a blocked preview and a changed dealer binding stops network access', async () => {
  const h = await fixture();
  try {
    await h.engine.query("UPDATE vehicles SET plate='AB12CDE' WHERE id=$1", ['00000000-0000-4000-8000-000000000002']);
    const before = await h.protectedSnapshot();
    const bytes = csv(); let transfers = 0;
    const dependencies = { repository: h.repository, now: () => new Date('2026-10-29T07:10:00Z'), readPassword: () => 'fixture-secret', readFile: async () => { transfers++; return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, modifiedAt: '2026-10-29T07:00:00Z' }; } };
    const result = await createCazooFeedCollector(dependencies).collect(config, { slotKey: 'manual:ambiguous' });
    assert.equal(result.value?.check.status, 'blocked');
    assert.equal(result.value?.check.errorCode, 'identity_review');
    assert.equal(result.value?.check.reconciliation?.status, 'blocked');
    assert.equal(result.value?.check.reconciliation?.candidateCars, null);
    assert.deepEqual(await h.protectedSnapshot(), before);
    await h.engine.query("UPDATE dealerships SET stock_platform='autotrader' WHERE id=$1", [config.dealerId]);
    const changedBefore = await h.protectedSnapshot();
    const changed = await createCazooFeedCollector(dependencies).collect(config, { slotKey: 'manual:wrong-dealer-binding' });
    assert.equal(changed.value?.check.errorCode, 'dealer_connection_mismatch');
    assert.equal(transfers, 1);
    assert.deepEqual(await h.protectedSnapshot(), changedBefore);
  } finally { await h.engine.close(); }
});

test('lease scoping rejects another dealer and advisory-lock ownership is released on failure', async () => {
  const h = await fixture();
  try {
    await assert.rejects(h.repository.withDealerLock(config.dealerId, lease => lease.save(blankCheck(otherDealer))), /dealership scope/);
    assert.equal(h.locks.size, 0);
    assert.equal((await h.engine.query('SELECT * FROM cazoo_feed_checks')).rows.length, 0);
    let finish!: () => void, entered!: () => void;
    const holding = new Promise<void>(resolve => { finish = resolve; });
    const acquired = new Promise<void>(resolve => { entered = resolve; });
    const first = h.repository.withDealerLock(config.dealerId, async () => { entered(); await holding; return 'first'; });
    await acquired;
    assert.equal((await h.repository.withDealerLock(config.dealerId, async () => 'should not run')).acquired, false);
    assert.equal((await h.repository.withDealerLock(otherDealer, async () => 'separate tenant')).acquired, true);
    finish(); assert.equal((await first).value, 'first');
    assert.equal(h.locks.size, 0);
    assert.equal(h.released(), 4);
  } finally { await h.engine.close(); }
});
