import { build } from 'esbuild';
await build({
  entryPoints: ['src/public-page-seo.test.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: '.cache/public-page-seo-tests/public-page-seo.test.mjs', external: ['*.node', 'pg-native'],
  banner: { js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);" },
});
