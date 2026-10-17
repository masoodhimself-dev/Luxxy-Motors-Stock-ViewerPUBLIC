import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { databasePoolConfig } from './pool-config';

const { Pool } = pg;

export const pool = new Pool(databasePoolConfig(process.env));
let lastIdleErrorAt: Date | null = null;
let idleErrorCount = 0;
let lastIdleErrorLogAt = 0;
// pg discards this idle client itself. A listener is still essential: an
// unhandled pool error otherwise terminates the whole API process.
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
