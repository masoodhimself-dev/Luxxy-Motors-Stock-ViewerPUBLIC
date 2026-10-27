import { build } from "esbuild";
import path from "node:path";
await build({
  entryPoints: [process.argv[2] || "src/enquiry-emails.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: path.join("dist-test", path.basename(process.argv[2] || "src/enquiry-emails.test.ts").replace(/\.ts$/, ".mjs")),
  external: ["@electric-sql/pglite", "@napi-rs/canvas"],
  plugins: [
    {
      name: "isolated-enquiry-email-tests",
      setup(b) {
        b.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: path.resolve("src/test/tenant-test-db.ts"),
        }));
        b.onResolve({ filter: /^@clerk\/express$/ }, () => ({
          path: path.resolve("src/test/inventory-clerk.ts"),
        }));
      },
    },
  ],
  banner: {
    js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);",
  },
});
