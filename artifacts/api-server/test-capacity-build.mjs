import { build } from 'esbuild';
import path from 'node:path';
const entry=process.argv[2] ?? 'src/dealer-capacity.test.ts';
await build({ entryPoints:[entry], bundle:true,platform:'node',format:'esm',outfile:`dist-capacity/${path.basename(entry,'.ts')}.mjs`,
  external:['@electric-sql/pglite','pino','pino-http'],
  plugins:[{name:'isolated-capacity-fixtures',setup(builder){
    // These tests exercise a lazy pg pool/mocked query with fictional URLs and
    // never connect. Other fixtures use embedded Postgres and fake Clerk users.
    const realPoolFixture = ['database-readiness.test.ts', 'appointment-diary.test.ts'].includes(path.basename(entry));
    if (!realPoolFixture) {
      builder.onResolve({filter:/^@workspace\/db$/},()=>({path:path.resolve('src/test/tenant-test-db.ts')}));
      builder.onResolve({filter:/^@clerk\/express$/},()=>({path:path.resolve('src/test/platform-clerk.ts')}));
    }
  }}],
  banner:{js:"import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);"},
});
