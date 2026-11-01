import { build } from "esbuild";
import path from "node:path";
await build({
  entryPoints: ["src/mot-stock-checks.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "dist-test/mot-stock-checks.test.mjs",
  external: ["@electric-sql/pglite", "@napi-rs/canvas"],
  plugins: [
    {
      name: "isolated-mot-stock-tests",
      setup(b) {
        b.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: path.resolve("src/test/tenant-test-db.ts"),
        }));
        b.onResolve({ filter: /^@workspace\/vehicle-meta$/ }, () => ({
          path: path.resolve("../../lib/vehicle-meta/src/index.ts"),
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
