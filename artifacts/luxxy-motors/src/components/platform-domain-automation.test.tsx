import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlatformDomainAutomation, type DomainJob } from './platform-domain-automation';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const job = (changes: Partial<DomainJob> = {}): DomainJob => ({
  id: 'job-one', hostname: 'example-dealer.co.uk', status: 'waiting', stage: 'https', attempts: 2,
  error: null, createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:01:00Z', nextAttemptAt: '2026-10-16T10:02:00Z',
  history: [{ at: '2026-10-16T10:00:00Z', stage: 'preflight', status: 'completed', message: 'Existing DNS checked.' }], ...changes,
});
const setup = (jobs: DomainJob[] = []) => ({ configured: true, reason: '', jobs });

it('explains missing secure configuration and preserves the manual setup option', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ configured: false, reason: 'Cloudflare access is not configured.', jobs: [] })));
  render(<PlatformDomainAutomation dealerId="demo-example" onUpdated={() => {}}/>);
  await screen.findByText('Secure connections are needed');
  expect(screen.getByText('Connect Cloudflare and Render in secure server settings first. Manual DNS setup remains available.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Connect domain' })).toBeDisabled();
  expect(screen.getByLabelText('Dealer’s domain')).toBeDisabled();
});

it('starts one domain job using a hostname and exposes progress without marking launch ready', async () => {
  let jobs: DomainJob[] = [];
  const writes: { path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path, init) => {
    if (init?.method === 'POST') {
      writes.push({ path: String(path), body: JSON.parse(String(init.body)) }); jobs = [job({ status: 'queued', stage: 'preflight' })];
      return Response.json({ job: jobs[0] }, { status: 202 });
    }
    return Response.json(setup(jobs));
  }));
  const updated = vi.fn();
  render(<PlatformDomainAutomation dealerId="demo-example" onUpdated={updated}/>);
  const input = await screen.findByLabelText('Dealer’s domain');
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: ' https://Example-Dealer.co.uk/ ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect domain' }));
  await screen.findByRole('article', { name: 'Domain setup for example-dealer.co.uk' });
  expect(writes).toEqual([{ path: '/api/platform/dealers/demo-example/domain-automation', body: { hostname: 'example-dealer.co.uk' } }]);
  expect(screen.getByText('Queued')).toBeInTheDocument();
  expect(screen.getByText(/It does not activate the dealership/)).toBeInTheDocument();
  expect(updated).not.toHaveBeenCalled();
});

it('rejects page URLs before sending a write', async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json(setup())));
  vi.stubGlobal('fetch', fetcher);
  render(<PlatformDomainAutomation dealerId="demo-example" onUpdated={() => {}}/>);
  await waitFor(() => expect(screen.getByLabelText('Dealer’s domain')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Dealer’s domain'), { target: { value: 'https://example-dealer.co.uk/stock' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect domain' }));
  await screen.findByText('Enter a domain such as dealer.co.uk, without a port or page path.');
  expect(fetcher.mock.calls.every(([, init]) => init.method !== 'POST')).toBe(true);
});

it('keeps a safe provider conflict visible after the read-only refresh', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_path, init) => init?.method === 'POST'
    ? Response.json({ error: 'Existing website DNS conflicts. Review the records first.' }, { status: 409 })
    : Response.json(setup())));
  render(<PlatformDomainAutomation dealerId="demo-example" onUpdated={() => {}}/>);
  await waitFor(() => expect(screen.getByLabelText('Dealer’s domain')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Dealer’s domain'), { target: { value: 'example-dealer.co.uk' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect domain' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Connect domain' })).toBeEnabled());
  expect(screen.getByRole('alert')).toHaveTextContent('Existing website DNS conflicts. Review the records first.');
});

it('polls waiting jobs serially and refreshes the workspace once on completion', async () => {
  vi.useFakeTimers();
  let resolveRead: ((value: Response) => void) | undefined;
  let reads = 0;
  const fetcher = vi.fn(async () => {
    reads++;
    if (reads === 2) return new Promise<Response>(resolve => { resolveRead = resolve; });
    return Response.json(setup([job()]));
  });
  vi.stubGlobal('fetch', fetcher);
  const updated = vi.fn();
  const rendered = render(<PlatformDomainAutomation dealerId="demo-example" onUpdated={updated}/>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(screen.getByText('Waiting for verification')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(reads).toBe(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(reads).toBe(2);
  await act(async () => { resolveRead?.(Response.json(setup([job({ status: 'completed', stage: 'complete', nextAttemptAt: null })]))); await Promise.resolve(); });
  expect(screen.getByText('DNS and Render verification completed. Check staff sign-in before launch.')).toBeInTheDocument();
  expect(updated).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(reads).toBe(2);
  rendered.unmount();
});

it('does not report an old completed job as a new completion', async () => {
  const updated = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(setup([job({ status: 'completed', stage: 'complete' })])))));
  render(<PlatformDomainAutomation dealerId="demo-example" onUpdated={updated}/>);
  await screen.findByText('Connected');
  expect(updated).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Retry setup/ })).not.toBeInTheDocument();
});

it('retries a blocked job only after an explicit operator action', async () => {
  let jobs = [job({ status: 'blocked', stage: 'preflight', error: 'Resolve conflicting DNS records first.', nextAttemptAt: null })];
  const writes: { path: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path, init) => {
    if (init?.method === 'POST') {
      writes.push({ path: String(path), body: JSON.parse(String(init.body)) });
      jobs = [job({ status: 'queued', stage: 'preflight' })];
      return Response.json({ job: jobs[0] }, { status: 202 });
    }
    return Response.json(setup(jobs));
  }));
  render(<PlatformDomainAutomation dealerId="demo-example" onUpdated={() => {}}/>);
  const retry = await screen.findByRole('button', { name: 'Retry setup for example-dealer.co.uk' });
  expect(writes).toHaveLength(0);
  fireEvent.click(retry);
  await screen.findByText('Queued');
  expect(writes).toEqual([{ path: '/api/platform/dealers/demo-example/domain-automation/job-one/retry', body: {} }]);
});

it('aborts a pending read and stops polling when the panel closes', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const fetcher = vi.fn((_path, init) => { signal = init.signal; return new Promise(() => {}); });
  vi.stubGlobal('fetch', fetcher);
  const rendered = render(<PlatformDomainAutomation dealerId="demo-example" onUpdated={() => {}}/>);
  await act(async () => { await Promise.resolve(); });
  rendered.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
