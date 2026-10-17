import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Keep embedded databases and loopback fixtures serial so test resources do not
// compete with each other or accidentally become the capacity measurement.
const entries = [
  'database-readiness',
  'stock-import-admission',
  'dealer-job-runner',
  'tenant-job-batches',
  'appointment-diary',
  'stock-snapshot-retention',
  'platform-capacity',
];
if (process.argv.includes('--benchmark')) entries.push('dealer-capacity');
const sources = entries.map(name => `src/${name}.test.ts`);
sources.push('../luxxy-motors/preview/platform-capacity.test.ts');
for (const source of sources) {
  for (const args of [
    ['test-capacity-build.mjs', source],
    ['--enable-source-maps', '--test', path.join('dist-capacity', `${path.basename(source, '.ts')}.mjs`)],
  ]) {
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
