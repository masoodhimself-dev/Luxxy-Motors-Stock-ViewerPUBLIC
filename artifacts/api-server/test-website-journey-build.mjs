import { build } from 'esbuild';
import path from 'node:path';

await build({
  entryPoints: ['src/website-journey.test.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: '.cache/website-journey/test.mjs', external: ['@electric-sql/pglite', '@napi-rs/canvas'],
  plugins: [{ name: 'isolated-website-journey', setup(bundle) {
    bundle.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.resolve('src/test/tenant-test-db.ts') }));
    bundle.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: path.resolve('src/test/invitation-clerk.ts') }));
  } }],
  banner: { js: "import {createRequire as testRequire} from 'node:module';const require=testRequire(import.meta.url);" },
});
