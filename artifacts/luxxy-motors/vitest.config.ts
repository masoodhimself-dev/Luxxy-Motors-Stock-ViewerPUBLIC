import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    // Node 25's native storage shadows jsdom Storage in forked test workers.
    // Keep browser storage owned by jsdom without requiring a shell flag.
    poolOptions: {
      forks: { execArgv: ['--no-experimental-webstorage'] },
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
