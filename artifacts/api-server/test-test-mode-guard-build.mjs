import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import esbuildPluginPino from 'esbuild-plugin-pino';
globalThis.require=createRequire(import.meta.url);
await mkdir('.cache/test-mode-guard',{recursive:true});
await build({entryPoints:['src/test-mode-app-guard.integration.test.ts'],platform:'node',bundle:true,format:'esm',outdir:'.cache/test-mode-guard',outExtension:{'.js':'.mjs'},external:['*.node','pg-native','@electric-sql/pglite','@napi-rs/canvas'],plugins:[esbuildPluginPino({transports:['pino-pretty']})],banner:{js:"import { createRequire as __bannerCrReq } from 'node:module'; globalThis.require=__bannerCrReq(import.meta.url);"}});
