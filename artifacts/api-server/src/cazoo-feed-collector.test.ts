import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  cazooCollectorConfiguration, cazooScheduledSlot, createCazooFeedCollector,
  createPostgresCazooFeedRepository, startCazooFeedCollector, type CazooCollectorDealer,
  type CazooCollectorLease, type CazooCollectorRepository, type CazooFeedCheck,
} from './lib/cazoo-feed-collector';
import { CAZOO_CSV_COLUMNS } from './lib/cazoo-csv';
import type { CazooExistingVehicle } from './lib/cazoo-reconciliation';
import { CazooSftpError, type CazooSftpConfig } from './lib/cazoo-sftp';
import { createServiceLifecycle } from './lib/service-lifecycle';

const config: CazooSftpConfig = {
  dealerId: 'demo-multi-choice-motors-cazoo-test', retailerId: 'cazoo-75497',
  feedId: 'AETA22820', dealerName: 'Multi-Choice Motors', dealerLocation: 'Hayes',
  host: 'u702248-sub1.your-storagebox.de', port: 22, username: 'u702248-sub1',
  remotePath: '/cazoo.csv', passwordEnv: 'CAZOO_SFTP_PASSWORD_MULTI_CHOICE',
  hostFingerprint: 'SHA256:EMlfI8GsRIfpVkoW1H2u0zYVpFGKkIMKHFZIRkf2ioI',
};
function stockCsv(values: Record<string, string> = {}) {
  const row: Record<string, string> = {
    ...Object.fromEntries(CAZOO_CSV_COLUMNS.map(header => [header, ''])),
    Feed_ID: 'AETA22820', Vehicle_ID: 'AETV12345678', FullRegistration: 'AB12CDE',
    Colour: 'Grey', FuelType: 'Petrol', Year: '2018', Mileage: '55000',
    Bodytype: 'HATCHBACK', Doors: '5', Make: 'Volkswagen', Model: 'Golf',
    Variant: '1.5 TSI SE Nav DSG', EngineSize: '1498', Price: '7990',
    Transmission: 'Automatic', PictureRefs: 'https://cdn.images.autoexposure.co.uk/AETA22820/AETV12345678_1.jpg?t=20261029101200',
    Options: 'Official dealer description.', New: 'N', Used: 'Y', V5: 'N',
    ExDemo: 'N', FranchisedApproved: 'N', DID: '75497', ...values,
  };
  const escape = (value: string) => /[,"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return Buffer.from([CAZOO_CSV_COLUMNS.join(','), CAZOO_CSV_COLUMNS.map(header => escape(row[header])).join(',')].join('\r\n') + '\r\n');
}
function file(bytes = stockCsv(), modifiedAt = '2026-10-29T07:00:00Z') {
  return { bytes, modifiedAt, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}
function memoryRepository() {
  const checks = new Map<string, CazooFeedCheck>();
  const locks = new Set<string>();
  const reads: string[] = [];
  let dealer: CazooCollectorDealer | null = { id: config.dealerId, status: 'active', stockPlatform: 'cazoo', retailerId: config.retailerId };
  let inventory: CazooExistingVehicle[] = [];
  const repository: CazooCollectorRepository = {
    async withDealerLock<T>(dealerId: string, work: (lease: CazooCollectorLease) => Promise<T>) {
      if (locks.has(dealerId)) return { acquired: false };
      locks.add(dealerId);
      try {
        const lease: CazooCollectorLease = {
          async getDealer() { reads.push('dealer'); return structuredClone(dealer); },
          async getSlot(slotKey) { return structuredClone(checks.get(`${dealerId}:${slotKey}`) ?? null); },
          async save(check) { assert.equal(check.dealerId, dealerId); checks.set(`${dealerId}:${check.slotKey}`, structuredClone(check)); },
          async latestReadyFile() {
            const latest = [...checks.values()].filter(check => check.dealerId === dealerId && check.status === 'ready').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
            return latest ? { id: latest.id, fileHash: latest.fileHash!, vehicleCount: latest.vehicleCount!, feedId: latest.candidate!.metadata.feedId, retailerId: latest.candidate!.metadata.retailerId } : null;
          },
          async inventory() { reads.push('inventory'); return structuredClone(inventory); },
        };
        return { acquired: true, value: await work(lease) };
      } finally { locks.delete(dealerId); }
    },
  };
  return { repository, checks, reads, setDealer: (next: CazooCollectorDealer | null) => { dealer = next; }, setInventory: (next: CazooExistingVehicle[]) => { inventory = next; }, inventory: () => structuredClone(inventory) };
}
function harness() {
  const state = memoryRepository();
  let at = new Date('2026-10-29T07:10:00Z');
  let transfer = file();
  let readCount = 0;
  let cause: Error | null = null;
  const dependencies = {
    repository: state.repository, now: () => new Date(at),
    readPassword: () => 'private-test-credential',
    readFile: async (connection: CazooSftpConfig, password: string) => {
      assert.equal(connection.dealerId, config.dealerId); assert.equal(password, 'private-test-credential');
      readCount++; if (cause) throw cause; return transfer;
    },
  };
  return { ...state, dependencies, collector: createCazooFeedCollector(dependencies),
    setTime: (value: string) => { at = new Date(value); }, setFile: (value: ReturnType<typeof file>) => { transfer = value; },
    failTransfer: (error: Error | null) => { cause = error; }, readsCount: () => readCount };
}

test('collection creates a durable private candidate without importing or changing vehicle/business records', async () => {
  const h = harness();
  const existing: CazooExistingVehicle = {
    id: 'existing-car', dealerId: config.dealerId, source: 'cazoo', advertId: '80238245',
    inventoryStatus: 'reserved', sourceStatus: 'live', make: 'Volkswagen', model: 'Golf', year: 2018,
    sourceHeroImage: 'https://cdn.images.autoexposure.co.uk/AETA22820/AETV12345678_1.jpg?t=old',
    websitePriceOverride: 8990, websiteDescription: 'Old browser description', auditMetadata: { booking: 'kept' },
  };
  h.setInventory([existing]);
  const before = h.inventory();
  const result = await h.collector.collect(config, { slotKey: 'manual:one' });
  assert.equal(result.value?.check.status, 'ready');
  assert.equal(result.value?.check.attempts, 1);
  assert.equal(result.value?.check.vehicleCount, 1);
  assert.equal(result.value?.check.remoteModifiedAt, '2026-10-29T07:00:00.000Z');
  assert.equal(result.value?.check.candidate?.cars[0].sourceExtras.description, 'Official dealer description.');
  assert.equal(result.value?.check.reconciliation?.candidateCars?.[0].advertId, '80238245');
  assert.equal(result.value?.check.reconciliation?.matches[0].preserveInventoryStatus, 'reserved');
  assert.deepEqual(h.inventory(), before);
  assert.ok(!JSON.stringify([...h.checks.values()]).includes('private-test-credential'));
  assert.equal(h.readsCount(), 1);
});

test('paused stock import acceptance is not needed for a collection-only connection', async () => {
  const h = harness();
  // The collector's dealer contract deliberately has no import-enabled flag or import credential.
  const result = await h.collector.collect(config);
  assert.equal(result.value?.check.status, 'ready');
  assert.equal(h.readsCount(), 1);
});

test('worker reports safe operational summaries once and skips completed slots after restart', async () => {
  const h = harness(), summaries: unknown[] = [], lifecycle = createServiceLifecycle();
  const options = { ...h.dependencies, lifecycle,
    env: { CAZOO_SFTP_ENABLED: 'true', CAZOO_SFTP_CONNECTIONS_JSON: JSON.stringify([config]) },
    onError: () => assert.fail('The collection should complete.'), onCheck: (summary: unknown) => summaries.push(summary),
  };
  let stop = startCazooFeedCollector(options);
  await lifecycle.waitForIdle(); stop();
  assert.deepEqual(summaries, [{ dealerId: config.dealerId, status: 'ready', attempts: 1, vehicleCount: 1, errorCode: null }]);
  stop = startCazooFeedCollector(options);
  await lifecycle.waitForIdle(); stop();
  assert.equal(h.readsCount(), 1);
  assert.equal(summaries.length, 1);
  assert.ok(!JSON.stringify(summaries).includes('private-test-credential'));
});

test('blocked checks reach the operational reporter without exposing a candidate or provider details', async () => {
  const h = harness(), summaries: unknown[] = [], lifecycle = createServiceLifecycle();
  h.setDealer(null);
  const stop = startCazooFeedCollector({ ...h.dependencies, lifecycle,
    env: { CAZOO_SFTP_ENABLED: 'true', CAZOO_SFTP_CONNECTIONS_JSON: JSON.stringify([config]) },
    onError: () => assert.fail('A blocked preview is handled.'), onCheck: summary => summaries.push(summary),
  });
  await lifecycle.waitForIdle(); stop();
  assert.deepEqual(summaries, [{ dealerId: config.dealerId, status: 'blocked', attempts: 1, vehicleCount: null, errorCode: 'dealer_connection_mismatch' }]);
  assert.equal(h.readsCount(), 0);
});

test('disabled configuration does not parse connections or touch the network', async () => {
  assert.deepEqual(cazooCollectorConfiguration({ CAZOO_SFTP_CONNECTIONS_JSON: 'not json' }), { enabled: false, connections: [] });
  assert.deepEqual(cazooCollectorConfiguration({ CAZOO_SFTP_ENABLED: 'false', CAZOO_SFTP_CONNECTIONS_JSON: 'secret' }), { enabled: false, connections: [] });
  assert.throws(() => cazooCollectorConfiguration({ CAZOO_SFTP_ENABLED: 'true' }), /missing/);
  assert.throws(() => cazooCollectorConfiguration({ CAZOO_SFTP_ENABLED: 'true', CAZOO_SFTP_CONNECTIONS_JSON: 'invalid' }), /invalid/);
  assert.throws(() => cazooCollectorConfiguration({ CAZOO_SFTP_ENABLED: 'true', CAZOO_SFTP_CONNECTIONS_JSON: JSON.stringify([config, config]) }), /one.*per dealership/);
  const enabled = cazooCollectorConfiguration({ CAZOO_SFTP_ENABLED: 'true', CAZOO_SFTP_CONNECTIONS_JSON: JSON.stringify([config]) });
  assert.equal(enabled.connections.length, 1);
});

test('London slots follow GMT and BST and initiate no polling outside the two bounded windows', async () => {
  assert.equal(cazooScheduledSlot(new Date('2026-10-24T06:10:00Z'))?.key, '2026-10-24:07:10:Europe/London');
  assert.equal(cazooScheduledSlot(new Date('2026-10-25T07:10:00Z'))?.key, '2026-10-25:07:10:Europe/London');
  assert.equal(cazooScheduledSlot(new Date('2026-03-29T06:10:00Z'))?.key, '2026-03-29:07:10:Europe/London');
  assert.equal(cazooScheduledSlot(new Date('2026-10-29T19:10:00Z'))?.key, '2026-10-29:19:10:Europe/London');
  assert.equal(cazooScheduledSlot(new Date('2026-10-29T07:10:00Z'))?.expiresAt, '2026-10-29T08:40:00.000Z');
  assert.ok(cazooScheduledSlot(new Date('2026-10-29T08:39:59Z')));
  for (const time of ['00:00', '07:00', '07:09', '08:40', '12:00', '19:09', '20:40', '23:59']) {
    const h = harness(); h.setTime(`2026-10-29T${time}:00Z`);
    assert.equal(cazooScheduledSlot(new Date(`2026-10-29T${time}:00Z`)), null);
    assert.deepEqual(await h.collector.tick([config]), []); assert.equal(h.readsCount(), 0);
  }
});

test('successful scheduled slots are checkpointed so repeated ticks and restarts do not reconnect', async () => {
  const h = harness();
  await h.collector.tick([config]);
  h.setTime('2026-10-29T07:20:00Z');
  await h.collector.tick([config]);
  const restarted = createCazooFeedCollector(h.dependencies);
  await restarted.tick([config]);
  assert.equal(h.readsCount(), 1);
  assert.equal(h.checks.size, 1);
});

test('unchanged file hashes create a small receipt and skip reparsing/inventory reconciliation', async () => {
  const h = harness();
  const first = await h.collector.collect(config, { slotKey: 'manual:first' });
  h.setTime('2026-10-29T19:10:00Z');
  const second = await h.collector.collect(config, { slotKey: 'manual:second' });
  assert.equal(second.value?.check.status, 'unchanged');
  assert.equal(second.value?.check.basedOnCheckId, first.value?.check.id);
  assert.equal(second.value?.check.candidate, null);
  assert.equal(second.value?.check.reconciliation, null);
  assert.equal(h.reads.filter(value => value === 'inventory').length, 1);
  assert.equal(h.readsCount(), 2);
});

test('an unchanged file is revalidated when the configured export feed identity changes', async () => {
  const h = harness();
  await h.collector.collect(config, { slotKey: 'manual:first' });
  const changed = await h.collector.collect({ ...config, feedId: 'AETA99999' }, { slotKey: 'manual:changed-config' });
  assert.equal(changed.value?.check.status, 'blocked');
  assert.equal(changed.value?.check.errorCode, 'wrong_feed');
  assert.equal(changed.value?.check.candidate, null);
});

test('a previous-slot file with the same hash waits for delivery and a late upload succeeds on the second attempt', async () => {
  const h = harness();
  const ready = await h.collector.collect(config, { slotKey: 'manual:morning-baseline' });
  h.setTime('2026-10-29T19:10:00Z');
  const early = await h.collector.tick([config]);
  assert.equal(early[0].value?.check.status, 'failed');
  assert.equal(early[0].value?.check.errorCode, 'awaiting_delivery');
  assert.equal(early[0].value?.check.candidate, null);
  assert.equal(early[0].value?.check.nextAttemptAt, '2026-10-29T19:25:00.000Z');
  assert.equal(h.reads.filter(value => value === 'inventory').length, 1);
  assert.equal([...h.checks.values()].find(check => check.id === ready.value?.check.id)?.status, 'ready');
  h.setFile(file(stockCsv(), '2026-10-29T19:15:00Z'));
  h.setTime('2026-10-29T19:25:00Z');
  const late = await createCazooFeedCollector(h.dependencies).tick([config]);
  assert.equal(late[0].value?.check.status, 'unchanged');
  assert.equal(late[0].value?.check.errorCode, null);
  assert.equal(late[0].value?.check.attempts, 2);
  assert.equal(late[0].value?.check.basedOnCheckId, ready.value?.check.id);
  assert.equal(late[0].value?.check.remoteModifiedAt, '2026-10-29T19:15:00.000Z');
});

test('an old changed file cannot be parsed or accepted before its scheduled delivery timestamp', async () => {
  const h = harness();
  await h.collector.collect(config, { slotKey: 'manual:morning-baseline' });
  h.setFile(file(stockCsv({ Price: '7890' }), '2026-10-29T18:59:59Z'));
  h.setTime('2026-10-29T19:10:00Z');
  const early = await h.collector.tick([config]);
  assert.equal(early[0].value?.check.status, 'failed');
  assert.equal(early[0].value?.check.errorCode, 'awaiting_delivery');
  assert.equal(early[0].value?.check.candidate, null);
  assert.equal(h.reads.filter(value => value === 'inventory').length, 1);
  h.setFile(file(stockCsv({ Price: '7890' }), '2026-10-29T19:02:00Z'));
  h.setTime('2026-10-29T19:25:00Z');
  const late = await h.collector.tick([config]);
  assert.equal(late[0].value?.check.status, 'ready');
  assert.equal(late[0].value?.check.attempts, 2);
  assert.equal(late[0].value?.check.candidate?.cars[0].price, 7890);
});

test('scheduled delivery freshness uses the expected 07:00 London upload across both DST changes', async () => {
  for (const day of [
    { at: '2026-10-24T06:10:00Z', old: '2026-10-24T05:59:59Z', expected: '2026-10-24T06:00:00Z' },
    { at: '2026-10-25T07:10:00Z', old: '2026-10-25T06:59:59Z', expected: '2026-10-25T07:00:00Z' },
    { at: '2026-03-29T06:10:00Z', old: '2026-03-29T05:59:59Z', expected: '2026-03-29T06:00:00Z' },
  ]) {
    const tooOld = harness(); tooOld.setTime(day.at); tooOld.setFile(file(stockCsv(), day.old));
    const waiting = await tooOld.collector.tick([config]);
    assert.equal(waiting[0].value?.check.errorCode, 'awaiting_delivery');
    const onTime = harness(); onTime.setTime(day.at); onTime.setFile(file(stockCsv(), day.expected));
    const ready = await onTime.collector.tick([config]);
    assert.equal(ready[0].value?.check.status, 'ready');
  }
});

test('recognised transport codes are retained with fixed safe messages and unknown codes are not persisted', async () => {
  const known = harness(); known.failTransfer(new CazooSftpError('connection_timeout', 'private-test-credential hidden path'));
  const failed = await known.collector.tick([config]);
  assert.equal(failed[0].value?.check.errorCode, 'connection_timeout');
  assert.equal(failed[0].value?.check.errorMessage, 'The private SFTP connection timed out. No stock was imported.');
  assert.ok(!JSON.stringify([...known.checks.values()]).includes('private-test-credential'));
  const unknown = harness(); unknown.failTransfer(new CazooSftpError('untrusted-code-private-test-credential', 'private-test-credential'));
  const generic = await unknown.collector.tick([config]);
  assert.equal(generic[0].value?.check.errorCode, 'collection_unavailable');
  assert.ok(!JSON.stringify([...unknown.checks.values()]).includes('private-test-credential'));
});

test('transfer failures retry after 15 minutes with a durable maximum of three attempts per slot', async () => {
  const h = harness(); h.failTransfer(new Error('remote problem private-test-credential'));
  let result = await h.collector.tick([config]);
  assert.equal(result[0].value?.check.status, 'failed');
  assert.equal(result[0].value?.check.nextAttemptAt, '2026-10-29T07:25:00.000Z');
  h.setTime('2026-10-29T07:20:00Z'); await h.collector.tick([config]);
  assert.equal(h.readsCount(), 1);
  h.setTime('2026-10-29T07:25:00Z'); await createCazooFeedCollector(h.dependencies).tick([config]);
  h.setTime('2026-10-29T07:40:00Z'); result = await h.collector.tick([config]);
  assert.equal(result[0].value?.check.attempts, 3);
  assert.equal(result[0].value?.check.nextAttemptAt, null);
  h.setTime('2026-10-29T08:00:00Z'); await createCazooFeedCollector(h.dependencies).tick([config]);
  assert.equal(h.readsCount(), 3);
  assert.ok(!JSON.stringify([...h.checks.values()]).includes('private-test-credential'));
});

test('a process crash retains its attempt and retry deadline instead of resetting the budget', async () => {
  const h = harness();
  await h.collector.tick([config]);
  const check = [...h.checks.values()][0];
  check.status = 'processing'; check.completedAt = null; check.nextAttemptAt = '2026-10-29T07:25:00.000Z';
  h.checks.set(`${config.dealerId}:${check.slotKey}`, check);
  h.setTime('2026-10-29T07:20:00Z'); await createCazooFeedCollector(h.dependencies).tick([config]);
  assert.equal(h.readsCount(), 1);
  h.setTime('2026-10-29T07:25:00Z'); const result = await createCazooFeedCollector(h.dependencies).tick([config]);
  assert.equal(h.readsCount(), 2);
  assert.equal(result[0].value?.check.attempts, 2);
});

test('overlapping collectors for one dealer use the same lease and only one opens SFTP', async () => {
  const h = harness();
  let finish!: () => void;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  let opened!: () => void;
  const connected = new Promise<void>(resolve => { opened = resolve; });
  let count = 0;
  const readFile = async () => { count++; opened(); await wait; return file(); };
  const one = createCazooFeedCollector({ ...h.dependencies, readFile });
  const two = createCazooFeedCollector({ ...h.dependencies, readFile });
  const first = one.collect(config, { slotKey: 'manual:overlap' });
  await connected;
  const second = await two.collect(config, { slotKey: 'manual:overlap' });
  assert.equal(second.acquired, false);
  finish(); await first;
  assert.equal(count, 1);
});

test('inactive, wrong-marketplace and wrong-retailer dealers are blocked before reading credentials or SFTP', async () => {
  for (const change of [{ status: 'draft' }, { status: 'suspended' }, { stockPlatform: 'autotrader' }, { retailerId: 'cazoo-other' }]) {
    const h = harness(); h.setDealer({ id: config.dealerId, status: 'active', stockPlatform: 'cazoo', retailerId: config.retailerId, ...change });
    let credentials = 0;
    const collector = createCazooFeedCollector({ ...h.dependencies, readPassword: () => { credentials++; return 'secret'; } });
    const result = await collector.collect(config);
    assert.equal(result.value?.check.status, 'blocked');
    assert.equal(result.value?.check.errorCode, 'dealer_connection_mismatch');
    assert.equal(h.readsCount(), 0); assert.equal(credentials, 0);
  }
});

test('missing credentials, malformed CSV, wrong DID and file metadata failures cannot create a ready candidate', async () => {
  const missing = harness();
  const missingResult = await createCazooFeedCollector({ ...missing.dependencies, readPassword: () => undefined }).collect(config);
  assert.equal(missingResult.value?.check.errorCode, 'missing_credential');
  assert.equal(missing.readsCount(), 0);
  for (const transfer of [
    file(Buffer.from('invalid csv')), file(stockCsv({ DID: '99999' })),
    { ...file(), sha256: '0'.repeat(64) }, { ...file(), size: 123 },
    file(stockCsv(), '2026-10-27T07:00:00Z'), file(stockCsv(), '2026-10-30T07:00:00Z'),
  ]) {
    const h = harness(); h.setFile(transfer);
    const result = await h.collector.collect(config, { slotKey: 'manual:invalid' });
    assert.equal(result.value?.check.status, 'blocked');
    assert.equal(result.value?.check.candidate, null);
    assert.ok(!h.reads.includes('inventory'));
    h.setTime('2026-10-29T07:30:00Z'); await h.collector.collect(config, { slotKey: 'manual:invalid' });
    assert.equal(h.readsCount(), 1);
  }
});

test('ambiguous identity produces a stored blocked preview and preserves all existing vehicles', async () => {
  const h = harness();
  const base = { dealerId: config.dealerId, source: 'cazoo', inventoryStatus: 'available', make: 'Volkswagen', model: 'Golf', year: 2018, plate: 'AB12CDE' };
  h.setInventory([{ ...base, id: 'one', advertId: '100' }, { ...base, id: 'two', advertId: '200' }]);
  const before = h.inventory();
  const result = await h.collector.collect(config);
  assert.equal(result.value?.check.status, 'blocked');
  assert.equal(result.value?.check.errorCode, 'identity_review');
  assert.equal(result.value?.check.reconciliation?.candidateCars, null);
  assert.deepEqual(h.inventory(), before);
});

test('Postgres repository pins a session lock, scopes inventory queries, and writes only private collection rows', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  let released = false;
  const pool = { async connect() { return {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
      if (sql.includes('FROM dealerships')) return { rows: [{ id: config.dealerId, status: 'active', stock_platform: 'cazoo', retailer_id: config.retailerId }] };
      return { rows: [] };
    }, release() { released = true; },
  }; } };
  const repository = await createPostgresCazooFeedRepository(pool);
  const collector = createCazooFeedCollector({ repository, now: () => new Date('2026-10-29T07:10:00Z'), readPassword: () => 'secret', readFile: async () => file() });
  await collector.collect(config);
  assert.ok(released);
  assert.ok(calls[0].sql.includes('pg_try_advisory_lock'));
  assert.ok(calls.at(-1)?.sql.includes('pg_advisory_unlock'));
  for (const call of calls.filter(call => /FROM (vehicles|vehicle_images|dealerships|cazoo_feed_checks)/.test(call.sql))) {
    assert.ok(call.sql.includes('$1')); assert.equal(call.values[0], config.dealerId);
  }
  assert.ok(calls.some(call => call.sql.includes("WHERE dealer_id=$1 AND source='cazoo'")));
  assert.ok(calls.some(call => call.sql.includes("WHERE v.dealer_id=$1 AND v.source='cazoo'")));
  assert.ok(calls.some(call => call.sql.startsWith('INSERT INTO cazoo_feed_checks')));
  assert.ok(!calls.some(call => /(?:UPDATE|DELETE FROM|INSERT INTO)\s+(?:vehicles|vehicle_images|sales|invoices|payments|enquiries)\b/i.test(call.sql)));
});
