import { build } from "esbuild";
import path from "node:path";
await build({
  entryPoints: ["src/stock-change-message-context.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".cache/price-context-tests/stock-change-message-context.test.mjs",
  external: [
    "@electric-sql/pglite",
    "@napi-rs/canvas",
    "ffmpeg-static",
    "ffprobe-static",
    "@aws-sdk/client-s3",
  ],
  plugins: [
    {
      name: "isolated-media-adapters",
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
    js: "import {createRequire as testRequire} from 'node:module';const require=testRequire(import.meta.url);",
  },
});
