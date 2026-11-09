import { build } from "esbuild";
import path from "node:path";
await build({
  entryPoints: ["src/cazoo-leads.test.ts", "src/cazoo-automatic-first-reply.test.ts", "src/cazoo-first-reply-delivery.test.ts"],
  bundle: true, platform: "node", format: "esm",
  outdir: ".cache/cazoo-leads", outExtension: { ".js": ".mjs" }, external: ["@electric-sql/pglite", "@napi-rs/canvas"],
  plugins: [{ name: "isolated-cazoo-lead-adapters", setup(b) {
    b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.resolve("src/test/tenant-test-db.ts") }));
    b.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: path.resolve("src/test/invitation-clerk.ts") }));
  }}],
  banner: { js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);" },
});
