import { build } from 'esbuild';
import path from 'node:path';

// These tests use explicit in-memory transaction clients. An unexpected import
// of the normal database adapter must fail rather than open a real connection.
await build({
  entryPoints: ['src/invoice-logo-assets.test.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: '.cache/invoice-logo-tests/invoice-logo-assets.test.mjs',
  external: ['@napi-rs/canvas'],
  plugins: [{ name: 'no-external-database', setup(b) {
    b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: 'invoice-logo-memory-only', namespace: 'invoice-logo-tests' }));
    b.onLoad({ filter: /.*/, namespace: 'invoice-logo-tests' }, () => ({ contents: `
      export * from ${JSON.stringify(path.resolve('../../lib/db/src/schema/index.ts'))};
      const forbidden = () => { throw new Error('Invoice logo tests must use their explicit memory database'); };
      export const db = new Proxy({}, { get: forbidden });
      export const pool = { query: forbidden, connect: forbidden, end() {} };
      export const databasePoolStatus = forbidden;
    `, loader: 'js', resolveDir: process.cwd() }));
  } }],
  banner: { js: "import { createRequire as testRequire } from 'node:module'; const require = testRequire(import.meta.url);" },
});
