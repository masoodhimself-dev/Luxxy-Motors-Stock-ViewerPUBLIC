import { build } from 'esbuild';
import path from 'node:path';
await build({
  entryPoints: ['src/search-visibility.test.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: '.cache/search-visibility-tests/search-visibility.test.mjs', external: ['@electric-sql/pglite'],
  plugins: [{ name: 'isolated-search-visibility-adapters', setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.resolve('src/test/tenant-test-db.ts') }));
    builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: path.resolve('src/test/inventory-clerk.ts') }));
  } }],
  banner: { js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);" },
});
