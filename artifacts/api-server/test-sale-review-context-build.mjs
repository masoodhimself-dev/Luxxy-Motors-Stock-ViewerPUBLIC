import { build } from 'esbuild';
import path from 'node:path';
await build({entryPoints:['src/sale-review-context.test.ts'],bundle:true,platform:'node',format:'esm',outfile:'.cache/sale-review-context/test.mjs',external:['@electric-sql/pglite','@napi-rs/canvas'],plugins:[{name:'test-db',setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:path.resolve('src/test/tenant-test-db.ts')}));}}],banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
