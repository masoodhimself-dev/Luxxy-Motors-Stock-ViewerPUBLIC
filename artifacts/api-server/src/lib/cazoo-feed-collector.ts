import { createHash, randomUUID } from 'node:crypto';
import { CazooCsvError, parseCazooCsv, type CazooCsvResult, type CazooCsvWarning } from './cazoo-csv';
import { planCazooReconciliation, type CazooExistingVehicle, type CazooReconciliationPlan } from './cazoo-reconciliation';
import { CazooSftpError, readCazooSftpFile, validateCazooSftpConfig, type CazooSftpConfig } from './cazoo-sftp';
import { startLifecycleWorker, type createServiceLifecycle } from './service-lifecycle';

export type CazooFeedCheck = {
  id: string;
  dealerId: string;
  slotKey: string;
  status: 'processing' | 'ready' | 'blocked' | 'unchanged' | 'failed';
  attempts: number;
  nextAttemptAt: string | null;
  receivedAt: string;
  completedAt: string | null;
  fileHash: string | null;
  fileBytes: number | null;
  remoteModifiedAt: string | null;
  vehicleCount: number | null;
  basedOnCheckId: string | null;
  warnings: CazooCsvWarning[];
  candidate: CazooCsvResult | null;
  reconciliation: CazooReconciliationPlan<CazooCsvResult['cars'][number]> | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type CazooCollectorDealer = {
  id: string;
  status: string;
  stockPlatform: string;
  retailerId: string;
};
export type CazooCollectorLease = {
  getDealer(): Promise<CazooCollectorDealer | null>;
  getSlot(slotKey: string): Promise<CazooFeedCheck | null>;
  save(check: CazooFeedCheck): Promise<void>;
  latestReadyFile(): Promise<{ id: string; fileHash: string; vehicleCount: number; feedId: string; retailerId: string } | null>;
  /** All statuses and all photos, with explicit dealership scope. */
  inventory(): Promise<CazooExistingVehicle[]>;
};
export type CazooCollectorRepository = {
  withDealerLock<T>(dealerId: string, work: (lease: CazooCollectorLease) => Promise<T>): Promise<{ acquired: boolean; value?: T }>;
};
export type CazooCollectorDependencies = {
  repository: CazooCollectorRepository;
  readFile?: typeof readCazooSftpFile;
  readPassword?: (environmentVariable: string) => string | undefined;
  now?: () => Date;
};

const RETRY_MS = 15 * 60_000;
const terminal = new Set<CazooFeedCheck['status']>(['ready', 'blocked', 'unchanged']);

/** Only these two local windows can initiate a scheduled network connection. */
export function cazooScheduledSlot(now: Date): { key: string; startsAt: string; expiresAt: string } | null {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  const start = [7 * 60 + 10, 19 * 60 + 10].find(value => minutes >= value && minutes < value + 90);
  if (start == null) return null;
  const elapsed = (minutes - start) * 60_000 + Number(part('second')) * 1000 + now.getUTCMilliseconds();
  const startsAt = new Date(now.getTime() - elapsed);
  return {
    key: `${part('year')}-${part('month')}-${part('day')}:${start < 12 * 60 ? '07:10' : '19:10'}:Europe/London`,
    startsAt: startsAt.toISOString(), expiresAt: new Date(startsAt.getTime() + 90 * 60_000).toISOString(),
  };
}

/** Disabled by default. Password values are separate environment secrets. */
export function cazooCollectorConfiguration(env: Record<string, string | undefined> = process.env): { enabled: boolean; connections: CazooSftpConfig[] } {
  if (env.CAZOO_SFTP_ENABLED !== 'true') return { enabled: false, connections: [] };
  const json = env.CAZOO_SFTP_CONNECTIONS_JSON;
  if (!json || Buffer.byteLength(json) > 64 * 1024) throw new Error('The Cazoo SFTP connection configuration is missing or too large.');
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('The Cazoo SFTP connection configuration is invalid.'); }
  if (!Array.isArray(raw) || !raw.length || raw.length > 20) throw new Error('Configure between one and twenty Cazoo SFTP connections.');
  let connections: CazooSftpConfig[];
  try { connections = raw.map(validateCazooSftpConfig); } catch { throw new Error('A Cazoo SFTP connection configuration is invalid.'); }
  if (new Set(connections.map(connection => connection.dealerId)).size !== connections.length)
    throw new Error('Only one Cazoo SFTP connection may be configured per dealership.');
  return { enabled: true, connections };
}

class CollectionBlocked extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
class CollectionRetryable extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}
const safeTransferMessages: Record<string, string> = {
  connection_timeout: 'The private SFTP connection timed out.',
  connection_failed: 'The private SFTP connection could not be verified or authenticated.',
  connection_closed: 'The private SFTP connection closed before download completed.',
  sftp_unavailable: 'The private SFTP service is unavailable.',
  file_unavailable: 'The Cazoo stock file is not yet available.',
  invalid_file: 'The Cazoo file is empty, too large or is not a regular file.',
  invalid_timestamp: 'The Cazoo file has an invalid modification time.',
  future_file: 'The Cazoo file has a future modification time.',
  upload_in_progress: 'The Cazoo file may still be uploading.',
  stale_file: 'The Cazoo file is more than 24 hours old.',
  file_changed: 'The Cazoo file changed during download.',
  download_failed: 'The private Cazoo stock download failed.',
  file_too_large: 'The Cazoo file exceeds the download limit.',
  missing_credential: 'The private Cazoo download credential is missing or invalid.',
  invalid_configuration: 'The private Cazoo connection configuration is invalid.',
};

/** Collection-only orchestration. There is deliberately no import or apply dependency. */
export function createCazooFeedCollector(dependencies: CazooCollectorDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const readFile = dependencies.readFile ?? readCazooSftpFile;
  const readPassword = dependencies.readPassword ?? (name => process.env[name]);

  async function collect(rawConfig: CazooSftpConfig, input: { slotKey?: string } = {}) {
    const config = validateCazooSftpConfig(rawConfig);
    const at = now();
    const slotKey = input.slotKey ?? `manual:${randomUUID()}`;
    if (!/^[a-zA-Z0-9:._/-]{1,160}$/.test(slotKey)) throw new Error('The collection slot identifier is invalid.');
    const scheduled = slotKey.endsWith(':Europe/London') ? cazooScheduledSlot(at) : null;
    if (slotKey.endsWith(':Europe/London') && scheduled?.key !== slotKey)
      throw new Error('The scheduled collection slot is outside its permitted window.');
    return dependencies.repository.withDealerLock(config.dealerId, async lease => {
      const prior = await lease.getSlot(slotKey);
      if (prior && (terminal.has(prior.status) || prior.attempts >= 3
        || (prior.nextAttemptAt && Date.parse(prior.nextAttemptAt) > at.getTime())))
        return { outcome: 'skipped' as const, check: prior };
      const check: CazooFeedCheck = {
        id: prior?.id ?? randomUUID(), dealerId: config.dealerId, slotKey,
        status: 'processing', attempts: (prior?.attempts ?? 0) + 1,
        nextAttemptAt: new Date(at.getTime() + RETRY_MS).toISOString(), receivedAt: at.toISOString(),
        completedAt: null, fileHash: null, fileBytes: null, remoteModifiedAt: null,
        vehicleCount: null, basedOnCheckId: null, warnings: [], candidate: null, reconciliation: null,
        errorCode: null, errorMessage: null,
      };
      // Persist the attempt before opening the connection. A restart cannot reset the retry budget.
      await lease.save(check);
      try {
        const dealer = await lease.getDealer();
        if (!dealer || dealer.id !== config.dealerId || dealer.status !== 'active'
          || dealer.stockPlatform !== 'cazoo' || dealer.retailerId !== config.retailerId)
          throw new CollectionBlocked('dealer_connection_mismatch', 'The active dealership no longer matches this Cazoo connection.');
        // Import acceptance may remain paused: a collection does not publish stock.
        const password = readPassword(config.passwordEnv);
        if (!password) throw new CollectionBlocked('missing_credential', 'The private SFTP credential is not configured.');
        const file = await readFile(config, password);
        const hash = createHash('sha256').update(file.bytes).digest('hex');
        if (file.sha256 !== hash || file.size !== file.bytes.length)
          throw new CollectionBlocked('file_integrity', 'The downloaded file did not match its transfer integrity metadata.');
        const modified = Date.parse(file.modifiedAt);
        if (!Number.isFinite(modified) || modified > at.getTime() + 5 * 60_000 || at.getTime() - modified > 24 * 60 * 60_000)
          throw new CollectionBlocked('file_timestamp', 'The stock file has an invalid, future or stale modification time.');
        check.fileHash = hash;
        check.fileBytes = file.size;
        check.remoteModifiedAt = new Date(modified).toISOString();
        // Seeing yesterday evening's file is not proof that today's 07:00
        // delivery is unchanged. Wait for this slot's observed upload before
        // deduplication; a late delivery can then succeed on the next attempt.
        if (scheduled && modified < Date.parse(scheduled.startsAt) - 10 * 60_000)
          throw new CollectionRetryable('awaiting_delivery', 'The next scheduled Cazoo delivery has not arrived yet. No stock was imported.');
        const previousFile = await lease.latestReadyFile();
        if (previousFile?.fileHash === hash && previousFile.feedId === config.feedId && previousFile.retailerId === config.retailerId) {
          check.status = 'unchanged';
          check.vehicleCount = previousFile.vehicleCount;
          check.basedOnCheckId = previousFile.id;
        } else {
          const candidate = parseCazooCsv(file.bytes, {
            dealerId: config.dealerId, expectedRetailerId: config.retailerId, expectedFeedId: config.feedId,
            dealerName: config.dealerName, dealerLocation: config.dealerLocation,
            capturedAt: check.remoteModifiedAt, maxBytes: 5 * 1024 * 1024,
          });
          const inventory = await lease.inventory();
          const reconciliation = planCazooReconciliation({ dealerId: config.dealerId, inventoryIncludesAllStatuses: true, incoming: candidate.cars, existing: inventory });
          check.candidate = candidate;
          check.reconciliation = reconciliation;
          check.warnings = candidate.warnings;
          check.vehicleCount = candidate.cars.length;
          check.status = reconciliation.status === 'preview_ready' ? 'ready' : 'blocked';
          if (check.status === 'blocked') {
            check.errorCode = 'identity_review';
            check.errorMessage = 'Vehicle identity reconciliation requires review. No stock was imported.';
          }
        }
        check.completedAt = now().toISOString();
        check.nextAttemptAt = null;
      } catch (error) {
        if (error instanceof CazooCsvError || error instanceof CollectionBlocked) {
          check.status = 'blocked';
          check.errorCode = error.code;
          check.errorMessage = error.message;
          check.completedAt = now().toISOString();
          check.nextAttemptAt = null;
        } else {
          check.status = 'failed';
          if (error instanceof CollectionRetryable) {
            check.errorCode = error.code;
            check.errorMessage = error.message;
          } else if (error instanceof CazooSftpError && Object.hasOwn(safeTransferMessages, error.code)) {
            check.errorCode = error.code;
            check.errorMessage = `${safeTransferMessages[error.code]} No stock was imported.`;
          } else {
            check.errorCode = 'collection_unavailable';
            // Provider errors can contain credentials or paths. Persist only this safe description.
            check.errorMessage = 'The private stock collection could not complete. No stock was imported.';
          }
          if (check.attempts >= 3) { check.completedAt = now().toISOString(); check.nextAttemptAt = null; }
        }
      }
      await lease.save(check);
      return { outcome: 'checked' as const, check };
    });
  }

  async function tick(connections: readonly CazooSftpConfig[]) {
    const slot = cazooScheduledSlot(now());
    if (!slot) return [];
    const results = [];
    // One connection at a time bounds memory, SSH sessions and database leases.
    for (const config of connections) {
      const current = cazooScheduledSlot(now());
      if (current?.key !== slot.key) break;
      results.push(await collect(config, { slotKey: slot.key }));
    }
    return results;
  }
  return { collect, tick };
}

/** Integrates with the existing drain/shutdown lifecycle, with no additional process. */
export function startCazooFeedCollector(options: CazooCollectorDependencies & {
  env?: Record<string, string | undefined>;
  lifecycle?: ReturnType<typeof createServiceLifecycle>;
  onError: () => void;
  onCheck?: (summary: Pick<CazooFeedCheck, 'dealerId' | 'status' | 'attempts' | 'vehicleCount' | 'errorCode'>) => void;
}) {
  const env = options.env ?? process.env;
  const collector = createCazooFeedCollector({ ...options, readPassword: options.readPassword ?? (name => env[name]) });
  return startLifecycleWorker({
    intervalMs: 10 * 60_000, lifecycle: options.lifecycle,
    enabled: () => env.CAZOO_SFTP_ENABLED === 'true', onError: options.onError,
    work: async () => {
      const config = cazooCollectorConfiguration(env);
      if (!config.enabled) return;
      for (const result of await collector.tick(config.connections)) {
        if (result.value?.outcome !== 'checked') continue;
        const { dealerId, status, attempts, vehicleCount, errorCode } = result.value.check;
        options.onCheck?.({ dealerId, status, attempts, vehicleCount, errorCode });
      }
    },
  });
}

type SqlClient = { query: (query: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }>; release: (error?: Error) => void };
type SqlPool = { connect: () => Promise<SqlClient> };
const iso = (value: unknown): string | null => value == null ? null : new Date(value as string | Date).toISOString();

function checkFromRow(row: Record<string, any>): CazooFeedCheck {
  return {
    id: row.id, dealerId: row.dealer_id, slotKey: row.slot_key, status: row.status,
    attempts: row.attempts, nextAttemptAt: iso(row.next_attempt_at), receivedAt: iso(row.received_at)!,
    completedAt: iso(row.completed_at), fileHash: row.file_hash, fileBytes: row.file_bytes,
    remoteModifiedAt: iso(row.remote_modified_at), vehicleCount: row.vehicle_count,
    basedOnCheckId: row.based_on_check_id, warnings: row.warnings ?? [], candidate: row.candidate,
    reconciliation: row.reconciliation, errorCode: row.error_code, errorMessage: row.error_message,
  };
}

/** Session advisory locks also exclude another Render instance and release on crashes. */
export async function createPostgresCazooFeedRepository(providedPool?: SqlPool): Promise<CazooCollectorRepository> {
  const pool = providedPool ?? (await import('@workspace/db')).pool as unknown as SqlPool;
  return {
    async withDealerLock<T>(dealerId: string, work: (lease: CazooCollectorLease) => Promise<T>) {
      const client = await pool.connect();
      let locked = false;
      try {
        locked = Boolean((await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [`cazoo-feed-collection:${dealerId}`])).rows[0]?.locked);
        if (!locked) return { acquired: false };
        const lease: CazooCollectorLease = {
          async getDealer() {
            const row = (await client.query('SELECT id,status,stock_platform,retailer_id FROM dealerships WHERE id=$1', [dealerId])).rows[0];
            return row ? { id: row.id, status: row.status, stockPlatform: row.stock_platform, retailerId: row.retailer_id } : null;
          },
          async getSlot(slotKey) {
            const row = (await client.query('SELECT * FROM cazoo_feed_checks WHERE dealer_id=$1 AND slot_key=$2', [dealerId, slotKey])).rows[0];
            return row ? checkFromRow(row) : null;
          },
          async save(check) {
            if (check.dealerId !== dealerId) throw new Error('The candidate dealership scope does not match the active collection lease.');
            await client.query(`INSERT INTO cazoo_feed_checks (id,dealer_id,slot_key,status,attempts,next_attempt_at,received_at,completed_at,file_hash,file_bytes,remote_modified_at,vehicle_count,based_on_check_id,warnings,candidate,reconciliation,error_code,error_message)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18)
              ON CONFLICT (dealer_id,slot_key) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,next_attempt_at=excluded.next_attempt_at,received_at=excluded.received_at,completed_at=excluded.completed_at,file_hash=excluded.file_hash,file_bytes=excluded.file_bytes,remote_modified_at=excluded.remote_modified_at,vehicle_count=excluded.vehicle_count,based_on_check_id=excluded.based_on_check_id,warnings=excluded.warnings,candidate=excluded.candidate,reconciliation=excluded.reconciliation,error_code=excluded.error_code,error_message=excluded.error_message`,
            [check.id, dealerId, check.slotKey, check.status, check.attempts, check.nextAttemptAt, check.receivedAt, check.completedAt, check.fileHash, check.fileBytes, check.remoteModifiedAt, check.vehicleCount, check.basedOnCheckId, JSON.stringify(check.warnings), check.candidate == null ? null : JSON.stringify(check.candidate), check.reconciliation == null ? null : JSON.stringify(check.reconciliation), check.errorCode, check.errorMessage]);
          },
          async latestReadyFile() {
            const row = (await client.query("SELECT id,file_hash,vehicle_count,candidate->'metadata'->>'feedId' AS feed_id,candidate->'metadata'->>'retailerId' AS retailer_id FROM cazoo_feed_checks WHERE dealer_id=$1 AND status='ready' AND file_hash IS NOT NULL ORDER BY received_at DESC LIMIT 1", [dealerId])).rows[0];
            return row ? { id: row.id, fileHash: row.file_hash, vehicleCount: row.vehicle_count, feedId: row.feed_id, retailerId: row.retailer_id } : null;
          },
          async inventory() {
            const rows = (await client.query("SELECT * FROM vehicles WHERE dealer_id=$1 AND source='cazoo'", [dealerId])).rows;
            const images = (await client.query("SELECT i.id,i.vehicle_id,i.source_url,i.origin,i.is_active FROM vehicle_images i INNER JOIN vehicles v ON v.id=i.vehicle_id WHERE v.dealer_id=$1 AND v.source='cazoo' ORDER BY i.sort_order,i.id", [dealerId])).rows;
            return rows.map(row => ({
              ...row, id: row.id, dealerId: row.dealer_id, source: row.source, advertId: row.advert_id,
              inventoryStatus: row.inventory_status, sourceStatus: row.source_status, archivedAt: row.archived_at,
              make: row.make, model: row.model, year: row.year, registration: row.registration,
              plate: row.plate, vrm: row.vrm, sourceHeroImage: row.source_hero_image,
              officialCazooVehicleId: row.audit_metadata?.officialCazooFeed?.vehicleId ?? null,
              websitePriceOverride: row.website_price_override, websiteTitleOverride: row.website_title_override,
              websiteDescription: row.website_description, websiteHeroImageOverride: row.website_hero_image_override,
              auditMetadata: row.audit_metadata, rawSourceData: row.raw_source_data, sourcePrice: row.source_price,
              images: images.filter(image => image.vehicle_id === row.id).map(image => ({ id: image.id, url: image.source_url, origin: image.origin, isActive: image.is_active })),
            }));
          },
        };
        return { acquired: true, value: await work(lease) };
      } finally {
        let releaseError: Error | undefined;
        if (locked) {
          try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [`cazoo-feed-collection:${dealerId}`]); }
          catch { releaseError = new Error('The collection lease could not be released; discard its connection.'); }
        }
        client.release(releaseError);
      }
    },
  };
}
