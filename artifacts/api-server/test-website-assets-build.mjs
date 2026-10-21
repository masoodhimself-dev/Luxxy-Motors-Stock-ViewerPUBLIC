import { build } from 'esbuild';
import path from 'node:path';

await build({
  entryPoints: ['src/dealer-website-assets.test.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: '.cache/website-assets-tests/dealer-website-assets.test.mjs', external: ['@electric-sql/pglite', '@napi-rs/canvas'],
  plugins: [{ name: 'isolated-website-assets-adapters', setup(b) {
    b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.resolve('src/test/tenant-test-db.ts') }));
    b.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: path.resolve('src/test/inventory-clerk.ts') }));
  } }],
  banner: { js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);" },
});
