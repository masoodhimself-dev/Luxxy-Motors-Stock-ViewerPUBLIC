import { build } from "esbuild";
import path from "node:path";
await build({
  entryPoints: ["src/delivery-evidence.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["@electric-sql/pglite", "@napi-rs/canvas"],
  outfile: "dist-test/delivery-evidence.test.mjs",
  plugins: [
    {
      name: "delivery-test-db",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: path.resolve("src/test/tenant-test-db.ts"),
        }));
      },
    },
  ],
  banner: {
    js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);",
  },
});
