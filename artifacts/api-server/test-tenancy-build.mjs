import { build } from "esbuild";
import path from "node:path";
const entry = process.argv[2] ?? "src/multitenancy.test.ts";
await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: `dist-test/${path.basename(entry, ".ts")}.mjs`,
  external: ["@electric-sql/pglite", "@napi-rs/canvas", "pino", "pino-http"],
  plugins: [
    {
      name: "isolated-tenancy-database",
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
