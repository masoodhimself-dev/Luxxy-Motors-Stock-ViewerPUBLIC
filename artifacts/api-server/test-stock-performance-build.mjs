import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import path from "node:path";
const baseline = process.argv.includes("--baseline");
await build({
  entryPoints: ["src/stock-performance.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: `dist-test/stock-performance${baseline ? "-baseline" : ""}.test.mjs`,
  external: ["@electric-sql/pglite", "pino", "pino-http"],
  plugins: [
    {
      name: "isolated-performance-database",
      setup(builder) {
        builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: path.resolve("src/test/tenant-test-db.ts"),
        }));
        builder.onResolve({ filter: /^@clerk\/express$/ }, () => ({
          path: path.resolve("src/test/platform-clerk.ts"),
        }));
        if (baseline)
          builder.onLoad({ filter: /\/routes\/stock\.ts$/ }, (args) => ({
            contents: execFileSync(
              "git",
              [
                "show",
                "7c75b994b6bb62bd2ee8f08901de139bc33f7f11:artifacts/api-server/src/routes/stock.ts",
              ],
              { encoding: "utf8" },
            ),
            loader: "ts",
            resolveDir: path.dirname(args.path),
          }));
      },
    },
  ],
  define: {
    "process.env.STOCK_PERFORMANCE_BASELINE": JSON.stringify(
      baseline ? "1" : "0",
    ),
  },
  banner: {
    js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);",
  },
});
