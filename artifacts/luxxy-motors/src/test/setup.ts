import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// This is a build-time asset URL, not an executing worker in jsdom. Keeping it
// stable also avoids serving a dependency symlink outside a test worktree.
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));

afterEach(() => {
  cleanup();
});

if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0);
}
