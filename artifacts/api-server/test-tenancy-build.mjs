import { build } from 'esbuild';
import path from 'node:path';
await build({ entryPoints: ['src/multitenancy.test.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-test/multitenancy.test.mjs', external: ['@electric-sql/pglite', 'pino', 'pino-http'], plugins: [{ name: 'isolated-tenancy-database', setup(builder) { builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.resolve('src/test/tenant-test-db.ts') })); } }], banner: { js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);" } });
