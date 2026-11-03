import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { SaleFinalReview } from './sale-final-review';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const sale = (revision = 1): SaleWorkspaceRecord => ({ id: 'sale-123', revision, reference: 'SALE-123', draft: {}, payments: [], documents: [], events: [] } as unknown as SaleWorkspaceRecord);
function checked(status: 'passed' | 'attention' | 'unavailable', revision = 2) {
  const saved = { ...sale(revision), finalReview: { id: `review-${revision}`, checkedAt: '2026-11-03T14:35:00Z', reviewedRevision: revision, status, summary: status === 'passed' ? 'The saved details are consistent.' : status === 'attention' ? 'Check the delivery charge.' : 'AI review is temporarily unavailable.', issues: status === 'attention' ? [{ field: 'handover', severity: 'error' as const, message: 'Delivery has been added twice.' }] : [] } };
  return { sale: saved, review: saved.finalReview };
}
it('shows honest pending text until the real response and saves a successful review', async () => {
  let respond!: (response: Response) => void;
  const fetcher = vi.fn((_url, _init) => new Promise<Response>(resolve => { respond = resolve; })); vi.stubGlobal('fetch', fetcher);
  const onSaved = vi.fn(); render(<SaleFinalReview sale={sale()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run final checks' }));
  expect(screen.getByRole('status')).toHaveTextContent('Please wait while AI checks the sale…');
  expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
  expect(screen.getByRole('list', { name: 'What is checked' }).children).toHaveLength(4);
  expect(onSaved).not.toHaveBeenCalled();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ expectedRevision: 1 });
  await act(async () => respond(Response.json(checked('passed'))));
  expect(await screen.findByText('Checks passed')).toBeInTheDocument(); expect(onSaved).toHaveBeenCalledWith(checked('passed').sale);
  expect(screen.getByRole('button', { name: 'Checked' })).toBeDisabled();
});
it('shows the specific issues and navigates to their field without providing an override', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(checked('attention'))));
  const navigate = vi.fn(); render(<SaleFinalReview sale={sale()} onSaved={vi.fn()} onNavigate={navigate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run final checks' }));
  expect(await screen.findByText('Needs attention')).toBeInTheDocument(); expect(screen.getByText('Delivery has been added twice.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open Collection and delivery' })); expect(navigate).toHaveBeenCalledWith('handover');
  expect(screen.queryByRole('button', { name: /override|continue anyway/i })).not.toBeInTheDocument();
});
it('offers retry after an unavailable check and uses the returned saved revision', async () => {
  const calls: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { calls.push(JSON.parse(init.body)); return Response.json(checked(calls.length === 1 ? 'unavailable' : 'passed', calls.length + 1)); }));
  render(<SaleFinalReview sale={sale()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run final checks' }));
  expect(await screen.findByText('Check unavailable')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry checks' }));
  expect(await screen.findByText('Checks passed')).toBeInTheDocument(); expect(calls).toEqual([{ expectedRevision: 1 }, { expectedRevision: 2 }]);
});
it('a pass expires when the saved revision changes and unsaved edits disable the check', async () => {
  const saved = checked('passed').sale;
  const view = render(<SaleFinalReview sale={saved} onSaved={vi.fn()} />);
  expect(screen.getByText('Checks passed')).toBeInTheDocument();
  view.rerender(<SaleFinalReview sale={{ ...saved, revision: 3 }} onSaved={vi.fn()} />);
  expect(screen.getByText('The sale has changed')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Run final checks' })).toBeEnabled();
  view.rerender(<SaleFinalReview sale={{ ...saved, revision: 3 }} onSaved={vi.fn()} disabled />);
  expect(screen.getByText('Save your changes, then run the final checks again.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Run final checks' })).toBeDisabled();
});
it('never overwrites a newer saved deal with an in-flight check response', async () => {
  let respond!: (response: Response) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
  const onSaved = vi.fn(), view = render(<SaleFinalReview sale={sale()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run final checks' }));
  await waitFor(() => expect(respond).toBeTypeOf('function'));
  view.rerender(<SaleFinalReview sale={sale(3)} onSaved={onSaved} />);
  await act(async () => respond(Response.json(checked('passed'))));
  expect(await screen.findByRole('alert')).toHaveTextContent('sale changed while the checks were running'); expect(onSaved).not.toHaveBeenCalled(); expect(screen.queryByText('Checks passed')).not.toBeInTheDocument();
});
it('keeps the draft and offers retry after network failure or an invalid review revision', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(Response.json({ ...checked('passed'), sale: { ...checked('passed').sale, revision: 5 } })); vi.stubGlobal('fetch', fetcher);
  const onSaved = vi.fn(); render(<SaleFinalReview sale={sale()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run final checks' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your saved deal is kept');
  fireEvent.click(screen.getByRole('button', { name: 'Retry checks' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your saved deal is kept'); expect(onSaved).not.toHaveBeenCalled();
});
it('preserves unsaved edits introduced while the saved deal is being checked', async () => {
  let respond!: (response: Response) => void; vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
  const onSaved = vi.fn(), view = render(<SaleFinalReview sale={sale()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run final checks' }));
  await waitFor(() => expect(respond).toBeTypeOf('function'));
  view.rerender(<SaleFinalReview sale={sale()} onSaved={onSaved} disabled />);
  await act(async () => respond(Response.json(checked('passed'))));
  expect(await screen.findByRole('alert')).toHaveTextContent('deal has unsaved changes'); expect(onSaved).not.toHaveBeenCalled();
});
it('aborts an outstanding display request when switching to another deal', async () => {
  let respond!: (response: Response) => void, signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', vi.fn((_url, init) => { signal = init.signal; return new Promise<Response>(resolve => { respond = resolve; }); }));
  const onSaved = vi.fn(), view = render(<SaleFinalReview sale={sale()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole('button', { name: 'Run final checks' }));
  await waitFor(() => expect(respond).toBeTypeOf('function'));
  view.rerender(<SaleFinalReview sale={{ ...sale(), id: 'another-sale' }} onSaved={onSaved} />);
  expect(signal?.aborted).toBe(true); expect(screen.getByRole('status')).toHaveTextContent('Final checks');
  await act(async () => respond(Response.json(checked('passed'))));
  expect(onSaved).not.toHaveBeenCalled(); expect(screen.queryByText('Checks passed')).not.toBeInTheDocument();
});
