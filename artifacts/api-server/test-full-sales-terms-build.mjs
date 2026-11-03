import { build } from 'esbuild';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
await mkdir('.cache/full-sales-terms', { recursive: true });
await build({ entryPoints: ['src/full-sales-terms.test.ts'], outfile: '.cache/full-sales-terms/full-sales-terms.test.mjs', bundle: true, platform: 'node', format: 'esm', external: ['@electric-sql/pglite', '@napi-rs/canvas'], plugins: [{name:'test-db',setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:path.resolve('src/test/tenant-test-db.ts')}));}}], banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" } });
