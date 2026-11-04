import { build } from 'esbuild';
import path from 'node:path';
await build({
  entryPoints: ['src/sale-calculation-check.test.ts', 'src/sale-workspace.test.ts', 'src/sale-workspace-connected.test.ts'], bundle: true, platform: 'node', format: 'esm', outdir: '.cache/sale-calculation', outExtension: {'.js':'.mjs'}, external: ['@electric-sql/pglite', '@napi-rs/canvas'],
  plugins: [{ name: 'isolated-sale-calculations', setup(b) { b.onResolve({filter:/^@workspace\/db$/},()=>({path:path.resolve('src/test/tenant-test-db.ts')})); b.onResolve({filter:/^@clerk\/express$/},()=>({path:path.resolve('src/test/inventory-clerk.ts')})); } }],
  banner: {js:"import {createRequire as testRequire} from 'node:module';const require=testRequire(import.meta.url);"},
});
