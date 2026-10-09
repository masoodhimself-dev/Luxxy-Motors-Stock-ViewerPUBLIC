import { defineConfig, mergeConfig } from 'vite';
import path from 'node:path';
import base from './vite.config';
export default mergeConfig(base, defineConfig({
  envDir: path.resolve(import.meta.dirname, '../../demos/cazoo'),
  envPrefix: 'CAZOO_DEMO_PUBLIC_',
  build: { outDir: path.resolve(import.meta.dirname, 'dist/cazoo-demo/public'), emptyOutDir: true },
  plugins: [{ name: 'cazoo-readonly-entry', transformIndexHtml: { order: 'pre', handler(html) { return html.replace('/src/main.tsx', '/src/cazoo-demo.tsx').replace(/<title>.*?<\/title>/, '<title>Cazoo stock display test</title>').replace(/<meta[^>]+(?:property|name)="(?:og:|twitter:)[^>]*>/g, '').replace(/<meta name="description"[^>]*>/, '<meta name="description" content="Read-only Cazoo stock display test">').replace('</head>', '<meta name="robots" content="noindex, nofollow"></head>'); } } }],
}));
