import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';


const port = Number(process.env.PORT ?? 4175);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const basePath = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base: basePath,
  envDir: path.resolve(import.meta.dirname, "../.."),
  // Clerk CLI writes this public key without the Vite prefix. Never expose
  // CLERK_SECRET_KEY or use the broad CLERK_ prefix here.
  envPrefix: ['VITE_', 'CLERK_PUBLISHABLE_KEY'],
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    proxy: {
      "/api": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080",
      "/share": process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8080",
    },
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
