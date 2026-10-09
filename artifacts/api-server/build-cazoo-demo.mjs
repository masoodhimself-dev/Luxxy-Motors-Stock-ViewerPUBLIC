import { build } from 'esbuild';
await build({ entryPoints: ['src/cazoo-demo-server.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'dist-cazoo/server.mjs', banner: { js: "import {createRequire as createDemoRequire} from 'node:module'; const require=createDemoRequire(import.meta.url);" } });
