import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { databasePoolConfig } from './pool-config';

const { Pool } = pg;

export const pool = new Pool(databasePoolConfig(process.env));
let lastIdleErrorAt: Date | null = null;
let idleErrorCount = 0;
let lastIdleErrorLogAt = 0;
let lastActiveErrorLogAt = 0;
// pg handles idle clients through the pool, but checked-out clients emit
// their own errors if the connection closes between queries.
function activeConnectionError() {
  const now = Date.now();
  if (now - lastActiveErrorLogAt < 30_000) return;
  lastActiveErrorLogAt = now;
  process.stderr.write('[database] A database connection closed while in use.\n');
}
pool.on('acquire', client => { client.on('error', activeConnectionError); });
pool.on('release', (_error, client) => { client.removeListener('error', activeConnectionError); });

pool.on('error', () => {
  lastIdleErrorAt = new Date();
  idleErrorCount++;
  if (lastIdleErrorAt.getTime() - lastIdleErrorLogAt >= 30_000) {
    lastIdleErrorLogAt = lastIdleErrorAt.getTime();
    process.stderr.write('[database] An idle database connection failed and was discarded.\n');
  }
});

/** Safe operational metadata only; callers must restrict this to platform admins. */
export function databasePoolStatus() {
  return {
    maximum: pool.options.max ?? 10,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    idleErrorCount,
    lastIdleErrorAt: lastIdleErrorAt?.toISOString() ?? null,
  };
}
export const db = drizzle(pool, { schema });

export * from "./schema";
