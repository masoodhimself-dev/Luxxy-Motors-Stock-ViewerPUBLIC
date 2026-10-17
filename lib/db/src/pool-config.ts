import type { PoolConfig } from 'pg';

type DatabaseEnvironment = Partial<Pick<NodeJS.ProcessEnv, 'DATABASE_URL' | 'DB_POOL_MAX' | 'DB_CONNECTION_TIMEOUT_MS' | 'DB_IDLE_TIMEOUT_MS' | 'DB_STATEMENT_TIMEOUT_MS' | 'DB_IDLE_TRANSACTION_TIMEOUT_MS'>>;

function integerSetting(env: DatabaseEnvironment, name: keyof DatabaseEnvironment, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < min || Number(raw) > max) {
    // Never include configuration values: a mistakenly pasted URL/key is private.
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return Number(raw);
}

/** One pool per process, shared by every dealer. Keep headroom for deploy overlap and admin tools. */
export function databasePoolConfig(env: DatabaseEnvironment): PoolConfig {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL must be set. Did you forget to provision a database?');
  return {
    connectionString: env.DATABASE_URL,
    max: integerSetting(env, 'DB_POOL_MAX', 10, 1, 30),
    min: 0,
    connectionTimeoutMillis: integerSetting(env, 'DB_CONNECTION_TIMEOUT_MS', 5_000, 500, 30_000),
    idleTimeoutMillis: integerSetting(env, 'DB_IDLE_TIMEOUT_MS', 30_000, 1_000, 300_000),
    // Server-side limits cancel abandoned statements/transactions. No client query
    // timer is used: it could return a still-executing client to the pool.
    statement_timeout: integerSetting(env, 'DB_STATEMENT_TIMEOUT_MS', 60_000, 5_000, 300_000),
    idle_in_transaction_session_timeout: integerSetting(env, 'DB_IDLE_TRANSACTION_TIMEOUT_MS', 60_000, 5_000, 300_000),
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: 'dealer-platform-api',
  };
}
