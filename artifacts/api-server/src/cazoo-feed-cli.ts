/** Operator-only download/preview tool. There is deliberately no apply command. */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCazooCsv } from './lib/cazoo-csv';
import { planCazooReconciliation } from './lib/cazoo-reconciliation';
import { CazooSftpError, readCazooSftpFile, validateCazooSftpConfig } from './lib/cazoo-sftp';

async function main() {
  const allowed = new Set(['--connection', '--password-file', '--output-dir', '--inventory']);
  const args = process.argv.slice(2), options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!, value = args[index + 1];
    if (!allowed.has(flag) || !value || value.startsWith('--') || options.has(flag)) throw new Error('Use --connection, --password-file, --output-dir and optional --inventory.');
    options.set(flag, value);
  }
  if (!options.has('--connection') || !options.has('--password-file') || !options.has('--output-dir')) throw new Error('Connection, private password file and output directory are required.');
  const config = validateCazooSftpConfig(JSON.parse(await readFile(options.get('--connection')!, 'utf8')));
  const secretPath = options.get('--password-file')!, secretStat = await stat(secretPath);
  if (!secretStat.isFile() || secretStat.size < 1 || secretStat.size > 1024 || (secretStat.mode & 0o077) !== 0) throw new Error('The password file must be a small owner-only file.');
  const password = await readFile(secretPath, 'utf8');
  const startedAt = new Date();
  const file = await readCazooSftpFile(config, password);
  const parsed = parseCazooCsv(file.bytes, { dealerId: config.dealerId, expectedRetailerId: config.retailerId, expectedFeedId: config.feedId, dealerName: config.dealerName, dealerLocation: config.dealerLocation, capturedAt: file.modifiedAt, maxBytes: 5 * 1024 * 1024 });
  const inventory = options.has('--inventory') ? JSON.parse(await readFile(options.get('--inventory')!, 'utf8')) : { dealerId: config.dealerId, includesAllStatuses: false, vehicles: [] };
  if (inventory.dealerId !== config.dealerId || !Array.isArray(inventory.vehicles)) throw new Error('The private inventory snapshot does not match this dealership.');
  const plan = planCazooReconciliation({ dealerId: config.dealerId, inventoryIncludesAllStatuses: inventory.includesAllStatuses === true, incoming: parsed.cars, existing: inventory.vehicles });
  const directory = path.resolve(options.get('--output-dir')!);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receipt = { startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), durationMs: Date.now() - startedAt.getTime(), dealerId: config.dealerId, retailerId: config.retailerId, fileBytes: file.size, sha256: file.sha256, remoteModifiedAt: file.modifiedAt, vehicleCount: parsed.cars.length, photos: parsed.cars.reduce((sum, car) => sum + car.images.length, 0), planStatus: plan.status, matches: plan.matches.length, creates: plan.creates.length, missing: plan.missing.length, importsAttempted: 0, remoteWritesAttempted: 0 };
  for (const [name, data] of [['candidate.json', parsed], ['reconciliation.json', plan], ['receipt.json', receipt]] as const) await writeFile(path.join(directory, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await writeFile(path.join(directory, 'download.csv'), file.bytes, { mode: 0o600 });
  console.log(JSON.stringify(receipt));
}

void main().catch(error => {
  // Never print arbitrary provider errors, configuration or credential contents.
  console.error(JSON.stringify({ status: 'failed', code: error instanceof CazooSftpError ? error.code : 'preview_failed', message: error instanceof CazooSftpError ? error.message : 'The private Cazoo preview could not complete. No stock was imported.' }));
  process.exitCode = 1;
});
