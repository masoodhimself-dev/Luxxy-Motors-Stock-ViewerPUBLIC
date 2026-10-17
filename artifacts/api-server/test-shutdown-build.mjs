import { build } from 'esbuild';
await build({
  entryPoints: ['src/service-lifecycle.test.ts', 'src/test/shutdown-signal-child.ts'],
  bundle: true, platform: 'node', format: 'esm', outbase: 'src',
  outdir: '.cache/shutdown-tests', outExtension: { '.js': '.mjs' },
  external: ['pg-native', '*.node'],
  banner: { js: "import {createRequire as testRequire} from 'node:module'; const require=testRequire(import.meta.url);" },
});
