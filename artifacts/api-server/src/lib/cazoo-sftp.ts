import { createHash, timingSafeEqual } from 'node:crypto';
import { Client, type SFTPWrapper, type Stats } from 'ssh2';

/** Configuration contains secret names only. Passwords never enter candidates or logs. */
export type CazooSftpConfig = {
  dealerId: string;
  retailerId: string;
  feedId: string;
  dealerName: string;
  dealerLocation?: string | null;
  host: string;
  port: 22;
  username: string;
  remotePath: string;
  passwordEnv: string;
  hostFingerprint: string;
};
export type CazooSftpFile = { bytes: Buffer; modifiedAt: string; sha256: string; size: number };
export class CazooSftpError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CazooSftpError'; }
}
const MAX_BYTES = 5 * 1024 * 1024;
const allowedKeys = new Set(['dealerId', 'retailerId', 'feedId', 'dealerName', 'dealerLocation', 'host', 'port', 'username', 'remotePath', 'passwordEnv', 'hostFingerprint']);
function invalid(): never { throw new CazooSftpError('invalid_configuration', 'Check the private Cazoo SFTP connection settings.'); }
export function validateCazooSftpConfig(raw: unknown): CazooSftpConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !allowedKeys.has(key))) invalid();
  const text = (key: string, maximum = 256) => {
    const candidate = value[key];
    if (typeof candidate !== 'string' || !candidate || candidate.length > maximum || candidate !== candidate.trim() || /[\u0000-\u001f\u007f]/.test(candidate)) invalid();
    return candidate as string;
  };
  const dealerId = text('dealerId', 128), retailerId = text('retailerId', 64), feedId = text('feedId', 64);
  const dealerName = text('dealerName'), host = text('host'), username = text('username', 64);
  const remotePath = text('remotePath'), passwordEnv = text('passwordEnv', 128), hostFingerprint = text('hostFingerprint', 128);
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(dealerId) || !/^(?:cazoo-)?[0-9]{1,20}$/.test(retailerId) || !/^AETA[0-9]+$/.test(feedId)) invalid();
  // This integration has no arbitrary-host or interactive-shell capability.
  if (!/^u[0-9]+-sub[0-9]+$/.test(username) || host !== `${username}.your-storagebox.de` || value.port !== 22) invalid();
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.csv$/.test(remotePath)) invalid();
  if (!/^CAZOO_SFTP_PASSWORD_[A-Z0-9_]+$/.test(passwordEnv) || !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(hostFingerprint)) invalid();
  const dealerLocation = value.dealerLocation;
  if (dealerLocation != null && (typeof dealerLocation !== 'string' || dealerLocation.length > 512 || /[\u0000-\u001f\u007f]/.test(dealerLocation))) invalid();
  return { dealerId, retailerId, feedId, dealerName, host, port: 22, username, remotePath, passwordEnv, hostFingerprint, ...(dealerLocation !== undefined ? { dealerLocation: dealerLocation as string | null } : {}) };
}

export function verifyCazooHostKey(key: Buffer, expected: string): boolean {
  const actual = Buffer.from(`SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`);
  const wanted = Buffer.from(expected.replace(/=+$/, ''));
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function fileStat(sftp: SFTPWrapper, method: 'lstat' | 'fstat', target: string | Buffer): Promise<Stats> {
  return new Promise((resolve, reject) => {
    const done = (error: Error | undefined, stats: Stats) => error ? reject(new CazooSftpError('file_unavailable', 'The Cazoo stock file is not available.')) : resolve(stats);
    if (method === 'lstat') sftp.lstat(target as string, done);
    else sftp.fstat(target as Buffer, done);
  });
}
function checkStat(stats: Stats, now: number, maxBytes: number) {
  if (!stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size <= 0 || stats.size > maxBytes) throw new CazooSftpError('invalid_file', 'The Cazoo file is empty, too large or is not a regular file.');
  if (!Number.isSafeInteger(stats.mtime) || stats.mtime <= 0) throw new CazooSftpError('invalid_timestamp', 'The Cazoo file has an invalid modification time.');
  const age = now - stats.mtime * 1000;
  if (age < -300_000) throw new CazooSftpError('future_file', 'The Cazoo file has a future modification time.');
  if (age < 60_000) throw new CazooSftpError('upload_in_progress', 'The Cazoo file may still be uploading.');
  if (age > 24 * 60 * 60 * 1000) throw new CazooSftpError('stale_file', 'The Cazoo file is more than 24 hours old.');
}
/** Only lstat/open(r)/fstat/read/close are used. There is no upload or delete path. */
async function readStableFile(sftp: SFTPWrapper, config: CazooSftpConfig, now: number, maxBytes: number, cancelled: () => boolean): Promise<CazooSftpFile> {
  const checkActive = () => { if (cancelled()) throw new CazooSftpError('connection_closed', 'The Cazoo download has already ended.'); };
  checkActive();
  const before = await fileStat(sftp, 'lstat', config.remotePath);
  checkActive();
  checkStat(before, now, maxBytes);
  const handle = await new Promise<Buffer>((resolve, reject) => sftp.open(config.remotePath, 'r', (error, value) => error ? reject(new CazooSftpError('file_unavailable', 'The Cazoo stock file could not be opened for reading.')) : resolve(value)));
  try {
    checkActive();
    const opened = await fileStat(sftp, 'fstat', handle);
    checkActive();
    checkStat(opened, now, maxBytes);
    if (opened.mtime !== before.mtime || opened.size !== before.size) throw new CazooSftpError('file_changed', 'The Cazoo file changed while opening it.');
    const chunks: Buffer[] = [];
    let position = 0;
    for (;;) {
      checkActive();
      // Read one byte beyond the maximum to detect a growing/incorrect stat.
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - position));
      const length = await new Promise<number>((resolve, reject) => sftp.read(handle, buffer, 0, buffer.length, position, (error, bytesRead) => error ? reject(new CazooSftpError('download_failed', 'The Cazoo stock file could not be downloaded.')) : resolve(bytesRead)));
      checkActive();
      if (!Number.isInteger(length) || length < 0 || length > buffer.length) throw new CazooSftpError('download_failed', 'The Cazoo file returned an invalid read.');
      if (!length) break;
      position += length;
      if (position > maxBytes) throw new CazooSftpError('file_too_large', 'The Cazoo stock file exceeds the download limit.');
      chunks.push(buffer.subarray(0, length));
    }
    const after = await fileStat(sftp, 'fstat', handle);
    checkActive();
    const current = await fileStat(sftp, 'lstat', config.remotePath);
    checkActive();
    if (!after.isFile() || !current.isFile() || before.mtime !== after.mtime || before.size !== after.size || before.mtime !== current.mtime || before.size !== current.size || position !== before.size) throw new CazooSftpError('file_changed', 'The Cazoo file changed during download. It will be checked again later.');
    const bytes = Buffer.concat(chunks, position);
    return { bytes, modifiedAt: new Date(before.mtime * 1000).toISOString(), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  } finally {
    await new Promise<void>(resolve => sftp.close(handle, () => resolve()));
  }
}

/** Password-only direct SFTP. Does not access Hetzner Console, browser cookies or OTPs. */
export async function readCazooSftpFile(config: CazooSftpConfig, password: string, testOptions: { clientFactory?: () => Client; now?: () => number; timeoutMs?: number; maxBytes?: number } = {}): Promise<CazooSftpFile> {
  validateCazooSftpConfig(config);
  if (!password || typeof password !== 'string' || password.length > 1024 || /[\r\n\u0000]/.test(password)) throw new CazooSftpError('missing_credential', 'The private Cazoo download credential is missing or invalid.');
  const client = testOptions.clientFactory?.() ?? new Client();
  const timeoutMs = Math.min(120_000, Math.max(1, testOptions.timeoutMs ?? 30_000));
  const maxBytes = Math.min(MAX_BYTES, Math.max(1, testOptions.maxBytes ?? MAX_BYTES));
  return new Promise<CazooSftpFile>((resolve, reject) => {
    let settled = false, ready = false;
    const finish = (error?: CazooSftpError, value?: CazooSftpFile) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      if (error) reject(error); else resolve(value!);
    };
    const timer = setTimeout(() => finish(new CazooSftpError('connection_timeout', 'The Cazoo SFTP connection timed out.')), timeoutMs);
    client.on('error', () => finish(new CazooSftpError(ready ? 'download_failed' : 'connection_failed', ready ? 'The Cazoo stock download failed.' : 'The Cazoo SFTP connection could not be verified or authenticated.')));
    client.on('close', () => { if (!settled) finish(new CazooSftpError('connection_closed', 'The Cazoo SFTP connection closed before the download finished.')); });
    client.on('ready', () => {
      if (settled) return;
      ready = true;
      client.sftp((error, sftp) => {
        if (settled) return;
        if (error) { finish(new CazooSftpError('sftp_unavailable', 'The Cazoo SFTP service is unavailable.')); return; }
        void readStableFile(sftp, config, (testOptions.now ?? Date.now)(), maxBytes, () => settled).then(value => finish(undefined, value), error => finish(error instanceof CazooSftpError ? error : new CazooSftpError('download_failed', 'The Cazoo stock download failed.')));
      });
    });
    try {
      client.connect({ host: config.host, port: config.port, username: config.username, password, tryKeyboard: false, authHandler: ['password'], readyTimeout: Math.min(timeoutMs, 15_000), keepaliveInterval: 5_000, keepaliveCountMax: 2, hostVerifier: (key: Buffer) => verifyCazooHostKey(key, config.hostFingerprint) });
    } catch { finish(new CazooSftpError('connection_failed', 'The Cazoo SFTP connection could not be started.')); }
  });
}
