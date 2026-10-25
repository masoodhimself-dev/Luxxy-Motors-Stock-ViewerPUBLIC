import { build } from 'esbuild';
import path from 'node:path';
const entry = process.argv[2] ?? 'src/platform-console.test.ts';
await build({ entryPoints:[entry],bundle:true,platform:'node',format:'esm',outfile:`dist-test/${path.basename(entry, '.ts')}.mjs`,external:['@electric-sql/pglite','@napi-rs/canvas'],plugins:[{name:'isolated-platform-adapters',setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:path.resolve('src/test/tenant-test-db.ts')}));b.onResolve({filter:/^@clerk\/express$/},()=>({path:path.resolve('src/test/platform-clerk.ts')}));}}],banner:{js:"import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);"}});
