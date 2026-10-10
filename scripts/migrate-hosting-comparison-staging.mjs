// Manual only: never called by the build, startup, or provider config.
import { spawnSync } from 'node:child_process';

function refuse(message) {
  console.error(message);
  process.exit(1);
}
if (process.env.MULTI_TENANT_ENABLED !== 'true' ||
    process.env.LUXXY_STAGING_MIGRATIONS_ALLOWED !== 'true') {
  refuse('Refusing migration: explicitly enable shared comparison staging migrations.');
}
let database;
try { database = new URL(process.env.DATABASE_URL ?? ''); }
catch { refuse('Refusing migration: a valid NEW staging DATABASE_URL is required.'); }
if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
    decodeURIComponent(database.pathname) !== '/luxxy_railway_staging') {
  refuse('Refusing migration: only the new luxxy_railway_staging database is allowed.');
}
// Never print the connection string or credentials.
const result = spawnSync('pnpm', ['--filter', '@workspace/db', 'migrate'], {
  stdio: 'inherit',
  env: process.env,
});
if (result.error) refuse('Migration command could not start.');
process.exit(result.status ?? 1);
