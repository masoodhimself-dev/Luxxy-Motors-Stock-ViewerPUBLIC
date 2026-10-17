import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlatformCapacity, type PlatformCapacityData } from './platform-capacity';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const snapshot: PlatformCapacityData = {
  generatedAt: '2026-10-17T14:00:00Z', scope: 'this_process',
  database: { ready: true, pool: { maximum: 10, total: 4, idle: 2, waiting: 0, idleErrorCount: 0, lastIdleErrorAt: null } },
  imports: { available: true, dealerCount: 2, attentionCount: 1, warningCount: 0, criticalCount: 1, missingConnectionCount: 0, neverImportedCount: 0,
    admission: { active: 1, maximum: 2, accepted: 5, rejected: 1, completed: 4, oldestActiveMs: 1_400 },
    dealers: [
      { dealerId: 'late', name: 'Late Motors', connectionConfigured: true, freshness: 'critical', ageSeconds: 15 * 3_600, lastSuccessfulCollectionAt: '2026-10-16T23:00:00Z', lastSuccessfulImportAt: '2026-10-16T23:01:00Z', lastAttemptAt: '2026-10-16T23:01:00Z', lastAttemptStatus: 'completed', needsAttention: true },
      { dealerId: 'fresh', name: 'Fresh Motors', connectionConfigured: true, freshness: 'fresh', ageSeconds: 3_600, lastSuccessfulCollectionAt: '2026-10-17T13:00:00Z', lastSuccessfulImportAt: '2026-10-17T13:01:00Z', lastAttemptAt: '2026-10-17T13:01:00Z', lastAttemptStatus: 'completed', needsAttention: false },
    ],
  },
  jobs: { concurrency: 2, activeDealerJobs: 1, queuedDealerJobs: 3, sweeps: [{ name: 'reminders', state: 'failed', startedAt: '2026-10-17T13:59:00Z', finishedAt: '2026-10-17T14:00:00Z', durationMs: 60_000, dealers: 2, completed: 1, failed: 1, excludedDemos: 1, maxActive: 2 }] },
};

it('shows current limits, overdue stock and worker results with honest scope', async () => {
  const open = vi.fn();
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json(snapshot)));
  vi.stubGlobal('fetch', fetcher);
  render(<PlatformCapacity onOpenDealer={open}/>);
  await screen.findByText('Responding');
  expect(fetcher.mock.calls[0][0]).toBe('/api/platform/capacity');
  expect(screen.getByText('4 / 10 connections · 0 waiting')).toBeInTheDocument();
  expect(screen.getByText('Stock overdue · 14h+')).toBeInTheDocument();
  expect(screen.getByText('15h 0m since collection · Latest attempt: completed')).toBeInTheDocument();
  expect(screen.getByText(/This snapshot is not a capacity certification/)).toBeInTheDocument();
  expect(screen.getByText('1 / 2 checks completed · 1 failed · 60.0s')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Late Motors' }));
  expect(open).toHaveBeenCalledWith('late');
});

it('refreshes only on request and preserves a clearly dated previous snapshot after failure', async () => {
  const fetcher = vi.fn().mockImplementationOnce(() => Promise.resolve(Response.json(snapshot))).mockImplementationOnce(() => Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 })));
  vi.stubGlobal('fetch', fetcher);
  render(<PlatformCapacity onOpenDealer={() => {}}/>);
  await screen.findByText('Responding');
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh operations' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The previous snapshot is shown below.');
  expect(screen.getByText('Responding')).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('shows missing import credentials and never mistakes unavailable freshness for healthy stock', async () => {
  const missing = { ...snapshot, database: { ...snapshot.database, ready: false }, imports: { ...snapshot.imports, available: false, dealers: undefined } };
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(missing))));
  render(<PlatformCapacity onOpenDealer={() => {}}/>);
  await screen.findByText('Needs attention');
  expect(screen.getByText('Stock freshness could not be checked. Refresh once the database is responding.')).toBeInTheDocument();
  expect(screen.queryByText('All connected dealers have fresh stock and no failed latest import.')).not.toBeInTheDocument();
});

it('aborts its read when leaving the overview', async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_path, init) => { signal = init?.signal; return new Promise(() => {}); }));
  const rendered = render(<PlatformCapacity onOpenDealer={() => {}}/>);
  await waitFor(() => expect(signal).toBeDefined());
  rendered.unmount();
  expect(signal?.aborted).toBe(true);
});

it('labels fictional local figures so they cannot be mistaken for production capacity', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json({ ...snapshot, scope: 'local_fixture' }))));
  render(<PlatformCapacity onOpenDealer={() => {}}/>);
  expect(await screen.findByText(/Fictional local sample for layout review/)).toBeInTheDocument();
  expect(screen.getByText(/Refreshing this local sample does not run jobs/)).toBeInTheDocument();
});
