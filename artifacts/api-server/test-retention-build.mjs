import { build } from 'esbuild';
import path from 'node:path';
await build({entryPoints:['src/data-retention.test.ts'],bundle:true,platform:'node',format:'esm',outfile:'dist-test/data-retention.test.mjs',external:['@electric-sql/pglite'],plugins:[{name:'isolated-retention',setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:path.resolve('src/test/tenant-test-db.ts')}));}}],banner:{js:"import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);"}});
