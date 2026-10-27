import { build } from "esbuild";
import path from "node:path";
await build({
  entryPoints: ["src/customer-email-replies.test.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: ".cache/reply-tests/customer-email-replies.test.mjs",
  external: ["@electric-sql/pglite", "@napi-rs/canvas"],
  plugins: [
    {
      name: "isolated-reply-adapters",
      setup(b) {
        b.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: path.resolve("src/test/tenant-test-db.ts"),
        }));
        b.onResolve({ filter: /^@clerk\/express$/ }, () => ({
          path: path.resolve("src/test/invitation-clerk.ts"),
        }));
      },
    },
  ],
  banner: {
    js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);",
  },
});
