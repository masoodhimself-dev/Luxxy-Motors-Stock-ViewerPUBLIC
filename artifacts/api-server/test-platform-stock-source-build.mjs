import { build } from 'esbuild';
import path from 'node:path';

await build({
  entryPoints:['src/platform-stock-connection.test.ts'],bundle:true,platform:'node',format:'esm',
  outfile:'.cache/platform-stock-source-tests/platform-stock-connection.test.mjs',external:['@electric-sql/pglite','@napi-rs/canvas'],
  plugins:[{name:'isolated-platform-source-adapters',setup(b){
    b.onResolve({filter:/^@workspace\/db$/},()=>({path:path.resolve('src/test/tenant-test-db.ts')}));
    b.onResolve({filter:/^@clerk\/express$/},()=>({path:path.resolve('src/test/platform-clerk.ts')}));
  }}],
  banner:{js:"import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);"},
});
