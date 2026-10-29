import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Client, ConnectConfig, SFTPWrapper, Stats } from 'ssh2';
import { CazooSftpError, readCazooSftpFile, validateCazooSftpConfig, verifyCazooHostKey, type CazooSftpConfig } from './lib/cazoo-sftp';

const now = Date.parse('2026-10-29T12:00:00Z');
const hostKey = Buffer.from('synthetic SSH server host key, never a real credential');
const fingerprint = `SHA256:${createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;
const config: CazooSftpConfig = {
  dealerId: 'multi-choice', retailerId: 'cazoo-75497', feedId: 'AETA22820', dealerName: 'Multi-Choice Motors', dealerLocation: 'Hayes',
  host: 'u123-sub1.your-storagebox.de', port: 22, username: 'u123-sub1', remotePath: '/cazoo.csv',
  passwordEnv: 'CAZOO_SFTP_PASSWORD_MULTI_CHOICE', hostFingerprint: fingerprint,
};
const secret = 'synthetic-test-password-only';
const privateError = new Error('provider diagnostic containing private password=synthetic-test-password-only');
const bytes = Buffer.from('Feed_ID,Vehicle_ID\r\nAETA22820,AETV123\r\n');
function stat(size = bytes.length, mtime = now / 1000 - 120, isFile = true): Stats {
  return { size, mtime, isFile: () => isFile, isDirectory: () => false, isSymbolicLink: () => false } as Stats;
}
type Call = { method: string; path?: string; flags?: string; position?: number; length?: number };

class FakeSftp {
  readonly calls: Call[] = [];
  data = Buffer.from(bytes);
  lstats = [stat(), stat()];
  fstats = [stat(), stat()];
  lstatFailure = false;
  openFailure = false;
  fstatFailure = false;
  readFailure = false;
  invalidReadLength: number | null = null;
  holdRead = false;
  pendingRead?: () => void;
  private lstatIndex = 0;
  private fstatIndex = 0;
  lstat(path: string, done: (error: Error | undefined, stats: Stats) => void) {
    this.calls.push({ method: 'lstat', path });
    queueMicrotask(() => done(this.lstatFailure ? privateError : undefined, this.lstats[Math.min(this.lstatIndex++, this.lstats.length - 1)]));
  }
  open(path: string, flags: string, done: (error: Error | undefined, handle: Buffer) => void) {
    this.calls.push({ method: 'open', path, flags });
    queueMicrotask(() => done(this.openFailure ? privateError : undefined, Buffer.from('read-only-handle')));
  }
  fstat(_handle: Buffer, done: (error: Error | undefined, stats: Stats) => void) {
    this.calls.push({ method: 'fstat' });
    queueMicrotask(() => done(this.fstatFailure ? privateError : undefined, this.fstats[Math.min(this.fstatIndex++, this.fstats.length - 1)]));
  }
  read(_handle: Buffer, buffer: Buffer, offset: number, length: number, position: number, done: (error: Error | undefined, read: number) => void) {
    this.calls.push({ method: 'read', position, length });
    const callback = () => {
      const count = Math.min(length, Math.max(0, this.data.length - position));
      this.data.copy(buffer, offset, position, position + count);
      done(this.readFailure ? privateError : undefined, this.invalidReadLength ?? count);
    };
    if (this.holdRead) this.pendingRead = callback; else queueMicrotask(callback);
  }
  close(_handle: Buffer, done: (error?: Error) => void) { this.calls.push({ method: 'close' }); queueMicrotask(() => done()); }
  write() { this.calls.push({ method: 'WRITE_FORBIDDEN' }); throw Error('Remote write forbidden'); }
  unlink() { this.calls.push({ method: 'UNLINK_FORBIDDEN' }); throw Error('Remote delete forbidden'); }
  rename() { this.calls.push({ method: 'RENAME_FORBIDDEN' }); throw Error('Remote rename forbidden'); }
}

class FakeClient extends EventEmitter {
  readonly ftp = new FakeSftp();
  connected?: ConnectConfig;
  destroyCount = 0;
  autoReady = true;
  suppliedHostKey = Buffer.from(hostKey);
  connectThrows = false;
  connectFailure = false;
  sftpFailure = false;
  holdSftp = false;
  pendingSftp?: () => void;
  connect(options: ConnectConfig) {
    this.connected = options;
    if (this.connectThrows) throw privateError;
    if (!this.autoReady) return this;
    queueMicrotask(() => {
      const verifier = options.hostVerifier as (key: Buffer) => boolean;
      if (!verifier(this.suppliedHostKey) || this.connectFailure) this.emit('error', privateError);
      else this.emit('ready');
    });
    return this;
  }
  sftp(done: (error: Error | undefined, sftp: SFTPWrapper) => void) {
    const callback = () => done(this.sftpFailure ? privateError : undefined, this.ftp as unknown as SFTPWrapper);
    if (this.holdSftp) this.pendingSftp = callback; else queueMicrotask(callback);
  }
  destroy() { this.destroyCount++; return this; }
}

function read(client: FakeClient, overrides: { timeoutMs?: number; maxBytes?: number } = {}) {
  return readCazooSftpFile(config, secret, { clientFactory: () => client as unknown as Client, now: () => now, timeoutMs: 1000, ...overrides });
}
async function rejectsCode(operation: Promise<unknown>, code: string) {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof CazooSftpError);
    assert.equal(error.code, code);
    assert.ok(!error.message.includes(secret));
    assert.ok(!error.message.includes('provider diagnostic'));
    return true;
  });
}
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));

test('strict private configuration rejects arbitrary hosts, ports, users, paths and secret-bearing extra fields', () => {
  assert.deepEqual(validateCazooSftpConfig(config), config);
  const invalid: Record<string, unknown>[] = [
    { host: 'attacker.invalid' }, { host: '127.0.0.1' }, { host: 'u123-sub1.your-storagebox.de.evil.invalid' },
    { host: 'u123-sub2.your-storagebox.de' }, { username: 'root' }, { username: 'u123' }, { port: 23 }, { port: '22' },
    { remotePath: '/../../secret.csv' }, { remotePath: '/folder/../cazoo.csv' }, { remotePath: '/%2e%2e/cazoo.csv' }, { remotePath: 'cazoo.csv' }, { remotePath: '/cazoo.csv\n' }, { remotePath: '/cazoo.csv/extra' }, { remotePath: '/cazoo.json' },
    { passwordEnv: 'DATABASE_URL' }, { passwordEnv: 'CAZOO_SFTP_PASSWORD_' }, { passwordEnv: 'CAZOO_SFTP_PASSWORD_X\n' },
    { hostFingerprint: '' }, { hostFingerprint: 'SHA256:wrong' }, { hostFingerprint: fingerprint + '\n' }, { hostFingerprint: undefined },
    { dealerId: '../other-dealer' }, { retailerId: 'autotrader-75497' }, { feedId: '75497' }, { dealerName: '' }, { dealerName: 'Dealer\r\nInjected' }, { dealerLocation: '\u0000' },
    { password: secret }, { privateKey: secret }, { debug: secret }, { proxy: 'http://attacker.invalid' },
  ];
  for (const overrides of invalid) {
    assert.throws(() => validateCazooSftpConfig({ ...config, ...overrides }), error => error instanceof CazooSftpError && error.code === 'invalid_configuration' && !error.message.includes(secret));
  }
  for (const value of [null, [], '', 22]) assert.throws(() => validateCazooSftpConfig(value), CazooSftpError);
  assert.equal(validateCazooSftpConfig({ ...config, remotePath: '/multi-choice/incoming/cazoo.csv', dealerLocation: null }).remotePath, '/multi-choice/incoming/cazoo.csv');
});

test('SSH host verification requires the exact pinned SHA256 fingerprint and does not accept another server', () => {
  assert.equal(verifyCazooHostKey(hostKey, fingerprint), true);
  assert.equal(verifyCazooHostKey(hostKey, fingerprint + '='), true);
  assert.equal(verifyCazooHostKey(Buffer.from('different-host-key'), fingerprint), false);
  assert.equal(verifyCazooHostKey(hostKey, 'SHA256:' + 'A'.repeat(43)), false);
});

test('successful download is password-only, pinned, hashed and restricted to read-only SFTP operations', async () => {
  const client = new FakeClient(), result = await read(client);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.size, bytes.length);
  assert.equal(result.modifiedAt, new Date(now - 120_000).toISOString());
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(client.destroyCount, 1);
  assert.equal(client.connected?.password, secret);
  assert.deepEqual(client.connected?.authHandler, ['password']);
  assert.equal(client.connected?.tryKeyboard, false);
  for (const key of ['privateKey', 'agent', 'agentForward', 'sock', 'debug', 'hostHash']) assert.equal(Object.hasOwn(client.connected!, key), false);
  assert.equal(typeof client.connected?.hostVerifier, 'function');
  assert.deepEqual(client.ftp.calls.map(call => call.method), ['lstat', 'open', 'fstat', 'read', 'read', 'fstat', 'lstat', 'close']);
  assert.equal(client.ftp.calls.find(call => call.method === 'open')?.flags, 'r');
  assert.ok(client.ftp.calls.every(call => !call.path || call.path === '/cazoo.csv'));
});

test('wrong pinned host key fails before any SFTP file operation and provider errors stay sanitized', async () => {
  const client = new FakeClient(); client.suppliedHostKey = Buffer.from('wrong server');
  await rejectsCode(read(client), 'connection_failed');
  assert.deepEqual(client.ftp.calls, []);
  assert.equal(client.destroyCount, 1);
});

test('missing, oversized or control-character credentials fail without constructing a client', async () => {
  for (const password of ['', 'x'.repeat(1025), 'line\nbreak', 'null\u0000byte']) {
    let constructed = false;
    await rejectsCode(readCazooSftpFile(config, password, { clientFactory: () => { constructed = true; return new FakeClient() as unknown as Client; } }), 'missing_credential');
    assert.equal(constructed, false);
  }
});

test('directories, symlinks, empty files, oversized and non-integer sizes are rejected before open', async () => {
  for (const initial of [stat(bytes.length, now / 1000 - 120, false), stat(0), stat(101), stat(1.5), stat(Number.NaN), stat(-1)]) {
    const client = new FakeClient(); client.ftp.lstats = [initial];
    await rejectsCode(read(client, { maxBytes: 100 }), 'invalid_file');
    assert.deepEqual(client.ftp.calls.map(call => call.method), ['lstat']);
    assert.equal(client.destroyCount, 1);
  }
});

test('invalid, future, recent and stale modification times fail with explicit non-secret errors', async () => {
  const cases: [number, string][] = [[0, 'invalid_timestamp'], [1.5, 'invalid_timestamp'], [Number.NaN, 'invalid_timestamp'], [now / 1000 + 301, 'future_file'], [now / 1000 - 59, 'upload_in_progress'], [now / 1000 - 86_401, 'stale_file']];
  for (const [mtime, code] of cases) {
    const client = new FakeClient(); client.ftp.lstats = [stat(bytes.length, mtime)];
    await rejectsCode(read(client), code);
    assert.deepEqual(client.ftp.calls.map(call => call.method), ['lstat']);
  }
});

test('the complete file at the 60-second stability and 24-hour freshness boundaries is accepted', async () => {
  for (const age of [60_000, 86_400_000]) {
    const client = new FakeClient(), timestamp = (now - age) / 1000;
    client.ftp.lstats = [stat(bytes.length, timestamp), stat(bytes.length, timestamp)];
    client.ftp.fstats = [stat(bytes.length, timestamp), stat(bytes.length, timestamp)];
    assert.deepEqual((await read(client)).bytes, bytes);
  }
});

test('changed size or modification time between lstat and open aborts before reading and closes the handle', async () => {
  for (const opened of [stat(bytes.length + 1), stat(bytes.length, now / 1000 - 121)]) {
    const client = new FakeClient(); client.ftp.fstats = [opened];
    await rejectsCode(read(client), 'file_changed');
    assert.deepEqual(client.ftp.calls.map(call => call.method), ['lstat', 'open', 'fstat', 'close']);
    assert.equal(client.destroyCount, 1);
  }
});

test('a non-regular opened handle is rejected, including an initial symlink-swap attempt', async () => {
  const client = new FakeClient(); client.ftp.fstats = [stat(bytes.length, now / 1000 - 120, false)];
  await rejectsCode(read(client), 'invalid_file');
  assert.deepEqual(client.ftp.calls.map(call => call.method), ['lstat', 'open', 'fstat', 'close']);
});

test('a lying stat or growing file cannot evade the hard byte-read limit', async () => {
  const client = new FakeClient(); client.ftp.data = Buffer.alloc(9, 'x');
  client.ftp.lstats = [stat(8)]; client.ftp.fstats = [stat(8)];
  await rejectsCode(read(client, { maxBytes: 8 }), 'file_too_large');
  assert.deepEqual(client.ftp.calls.filter(call => call.method === 'read').map(call => [call.position, call.length]), [[0, 9]]);
  assert.equal(client.ftp.calls.at(-1)?.method, 'close');
  assert.equal(client.destroyCount, 1);
});

test('a file exactly at the read limit succeeds and performs only one extra-byte EOF probe', async () => {
  const client = new FakeClient(); client.ftp.data = Buffer.alloc(8, 'x');
  client.ftp.lstats = [stat(8), stat(8)]; client.ftp.fstats = [stat(8), stat(8)];
  assert.equal((await read(client, { maxBytes: 8 })).size, 8);
  assert.deepEqual(client.ftp.calls.filter(call => call.method === 'read').map(call => [call.position, call.length]), [[0, 9], [8, 1]]);
});

test('downloads are chunked and ordered rather than allocating from an untrusted stat size', async () => {
  const client = new FakeClient(), size = 150_000; client.ftp.data = Buffer.alloc(size, 'a');
  client.ftp.lstats = [stat(size), stat(size)]; client.ftp.fstats = [stat(size), stat(size)];
  assert.equal((await read(client, { maxBytes: size })).size, size);
  const reads = client.ftp.calls.filter(call => call.method === 'read');
  assert.ok(reads.every(call => call.length! <= 64 * 1024));
  assert.deepEqual(reads.map(call => call.position), [0, 65_536, 131_072, 150_000]);
});

test('short reads, changed final fstat and replaced final path all fail closed', async () => {
  const short = new FakeClient(); short.ftp.data = bytes.subarray(0, bytes.length - 1);
  await rejectsCode(read(short), 'file_changed');
  const changedHandle = new FakeClient(); changedHandle.ftp.fstats = [stat(), stat(bytes.length + 1)];
  await rejectsCode(read(changedHandle), 'file_changed');
  const replacedPath = new FakeClient(); replacedPath.ftp.lstats = [stat(), stat(bytes.length, now / 1000 - 121)];
  await rejectsCode(read(replacedPath), 'file_changed');
  const nonRegularPath = new FakeClient(); nonRegularPath.ftp.lstats = [stat(), stat(bytes.length, now / 1000 - 120, false)];
  await rejectsCode(read(nonRegularPath), 'file_changed');
  for (const client of [short, changedHandle, replacedPath, nonRegularPath]) assert.equal(client.ftp.calls.at(-1)?.method, 'close');
});

test('the final handle must still be a regular file even if size and time are unchanged', async () => {
  const client = new FakeClient(); client.ftp.fstats = [stat(), stat(bytes.length, now / 1000 - 120, false)];
  await rejectsCode(read(client), 'file_changed');
  assert.equal(client.ftp.calls.at(-1)?.method, 'close');
});

test('invalid read lengths reject without retaining or publishing partial file contents', async () => {
  for (const length of [-1, 1.5, Number.NaN, 1_000_000]) {
    const client = new FakeClient(); client.ftp.invalidReadLength = length;
    await rejectsCode(read(client), 'download_failed');
    assert.equal(client.ftp.calls.at(-1)?.method, 'close');
  }
});

test('authentication, SFTP subsystem, file stat, open and read failures are sanitized and cleaned up', async () => {
  const connection = new FakeClient(); connection.connectFailure = true;
  await rejectsCode(read(connection), 'connection_failed');
  const subsystem = new FakeClient(); subsystem.sftpFailure = true;
  await rejectsCode(read(subsystem), 'sftp_unavailable');
  const unavailable = new FakeClient(); unavailable.ftp.lstatFailure = true;
  await rejectsCode(read(unavailable), 'file_unavailable');
  const openFailure = new FakeClient(); openFailure.ftp.openFailure = true;
  await rejectsCode(read(openFailure), 'file_unavailable');
  const handleStat = new FakeClient(); handleStat.ftp.fstatFailure = true;
  await rejectsCode(read(handleStat), 'file_unavailable');
  const failedRead = new FakeClient(); failedRead.ftp.readFailure = true;
  await rejectsCode(read(failedRead), 'download_failed');
  assert.equal(handleStat.ftp.calls.at(-1)?.method, 'close');
  assert.equal(failedRead.ftp.calls.at(-1)?.method, 'close');
  for (const client of [connection, subsystem, unavailable, openFailure, handleStat, failedRead]) assert.equal(client.destroyCount, 1);
});

test('a synchronous provider connect exception is sanitized and destroys the client', async () => {
  const client = new FakeClient(); client.connectThrows = true;
  await rejectsCode(read(client), 'connection_failed');
  assert.equal(client.destroyCount, 1);
  assert.deepEqual(client.ftp.calls, []);
});

test('a connection timeout destroys the client without starting file operations', async () => {
  const client = new FakeClient(); client.autoReady = false;
  await rejectsCode(read(client, { timeoutMs: 5 }), 'connection_timeout');
  assert.equal(client.destroyCount, 1);
  assert.deepEqual(client.ftp.calls, []);
});

test('an early close is reported once and late connection errors do not settle a second time', async () => {
  const client = new FakeClient(); client.autoReady = false;
  const operation = read(client); client.emit('close');
  await rejectsCode(operation, 'connection_closed');
  client.emit('error', privateError); client.emit('close');
  assert.equal(client.destroyCount, 1);
  assert.deepEqual(client.ftp.calls, []);
});

test('late ready events after a timeout cannot begin a new SFTP download', async () => {
  const client = new FakeClient(); client.autoReady = false;
  await rejectsCode(read(client, { timeoutMs: 5 }), 'connection_timeout');
  client.emit('ready'); await nextTurn();
  assert.deepEqual(client.ftp.calls, []);
  assert.equal(client.destroyCount, 1);
});

test('a late SFTP callback after early close cannot open or read the stock file', async () => {
  const client = new FakeClient(); client.holdSftp = true;
  const operation = read(client); await nextTurn();
  assert.equal(typeof client.pendingSftp, 'function');
  client.emit('close'); await rejectsCode(operation, 'connection_closed');
  client.pendingSftp!(); await nextTurn();
  assert.deepEqual(client.ftp.calls, []);
  assert.equal(client.destroyCount, 1);
});

test('timeout during an in-flight read destroys the connection and never returns a partial success', async () => {
  const client = new FakeClient(); client.ftp.holdRead = true;
  const operation = read(client, { timeoutMs: 10 });
  await nextTurn(); assert.equal(typeof client.ftp.pendingRead, 'function');
  await rejectsCode(operation, 'connection_timeout');
  client.ftp.readFailure = true;
  client.ftp.pendingRead!(); await nextTurn();
  assert.equal(client.destroyCount, 1);
  assert.equal(client.ftp.calls.at(-1)?.method, 'close');
});

test('a successful read callback queued after timeout cannot continue reading or statting the file', async () => {
  const client = new FakeClient(); client.ftp.holdRead = true;
  const operation = read(client, { timeoutMs: 10 });
  await nextTurn(); assert.equal(typeof client.ftp.pendingRead, 'function');
  await rejectsCode(operation, 'connection_timeout');
  const before = client.ftp.calls.length;
  client.ftp.holdRead = false;
  client.ftp.pendingRead!(); await nextTurn();
  assert.deepEqual(client.ftp.calls.slice(before).map(call => call.method), ['close']);
  assert.equal(client.destroyCount, 1);
});

test('an EOF callback queued after timeout cannot trigger final remote stat operations', async () => {
  const client = new FakeClient(); client.ftp.holdRead = true;
  const operation = read(client, { timeoutMs: 10 });
  await nextTurn(); assert.equal(typeof client.ftp.pendingRead, 'function');
  await rejectsCode(operation, 'connection_timeout');
  const before = client.ftp.calls.length;
  client.ftp.data = Buffer.alloc(0);
  client.ftp.holdRead = false;
  client.ftp.pendingRead!(); await nextTurn();
  assert.deepEqual(client.ftp.calls.slice(before).map(call => call.method), ['close']);
  assert.equal(client.destroyCount, 1);
});
