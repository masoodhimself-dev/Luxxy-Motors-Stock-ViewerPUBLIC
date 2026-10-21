import { build } from 'esbuild';
import path from 'node:path';

await build({
  entryPoints: ['src/seo-crawl.test.ts', 'src/indexnow.test.ts'], bundle: true, platform: 'node', format: 'esm',
  outdir: '.cache/seo-crawl-tests', outExtension: { '.js': '.mjs' },
  external: ['@electric-sql/pglite', 'pino', 'pino-http'],
  plugins: [{ name: 'isolated-seo-crawl-adapters', setup(builder) {
    builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.resolve('src/test/tenant-test-db.ts') }));
    builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: path.resolve('src/test/platform-clerk.ts') }));
  } }],
  banner: { js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);" },
});
