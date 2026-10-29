import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const names = process.argv.includes('--cli') ? ['cazoo-feed-cli'] : ['cazoo-csv.test', 'cazoo-reconciliation.test', 'cazoo-sftp.test', 'cazoo-feed-collector.test', 'cazoo-feed-database.test'];
await build({
  entryPoints: names.map(name => path.join(root, 'src', `${name}.ts`)),
  outdir: path.join(root, '.cache/cazoo-feed'), outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'node', format: 'esm', sourcemap: 'linked',
  external: ['ssh2', 'pg-native', '@electric-sql/pglite', '@workspace/db'],
  banner: { js: "import { createRequire } from 'node:module'; globalThis.require = createRequire(import.meta.url);" },
});
