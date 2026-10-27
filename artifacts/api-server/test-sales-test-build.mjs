import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('.cache/sales-test', { recursive: true });
await build({
  entryPoints: ['src/sales-test.integration.test.ts'],
  bundle: true, platform: 'node', format: 'esm',
  outfile: '.cache/sales-test/integration.mjs',
  external: ['*.node', 'pg-native', '@napi-rs/canvas'],
  banner: { js: "import { createRequire } from 'node:module'; globalThis.require = createRequire(import.meta.url);" },
});
