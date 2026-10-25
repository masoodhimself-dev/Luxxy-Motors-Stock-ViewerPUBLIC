import { build } from 'esbuild';

// Publication tests use only explicit in-memory transactions and never load a database adapter.
await build({
  entryPoints: ['src/settings-publication.test.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: '.cache/settings-publication-tests/settings-publication.test.mjs',
});
