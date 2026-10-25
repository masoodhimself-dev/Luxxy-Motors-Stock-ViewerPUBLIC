import { build } from "esbuild";
import path from "node:path";
const input = process.argv[2] || "src/vehicle-watch-events.test.ts";
await build({
  entryPoints:[input],bundle:true,platform:"node",format:"esm",
  outfile:path.join(".cache/watch-event-tests",path.basename(input).replace(/\.ts$/,".mjs")),external:["@electric-sql/pglite","@napi-rs/canvas","ffmpeg-static","ffprobe-static","@aws-sdk/client-s3"],
  plugins:[{name:"isolated-watch-db",setup(b){b.onResolve({filter:/^@workspace\/db$/},()=>({path:path.resolve("src/test/tenant-test-db.ts")}));b.onResolve({filter:/^@clerk\/express$/},()=>({path:path.resolve("src/test/inventory-clerk.ts")}));}}],
  banner:{js:"import {createRequire as testRequire} from 'node:module';const require=testRequire(import.meta.url);"},
});
