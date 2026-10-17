import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Enquiry } from '@workspace/api-client-react';
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@workspace/api-client-react', async original => ({
  ...await original<object>(), customFetch: (...args: unknown[]) => state.fetch(...args),
}));
import { ConversationHistory } from './enquiry-conversation';
const entry = { id: 'fictional-enquiry', reference: 'ENQ-FICTIONAL', customerName: 'Alex Example', message: 'Original customer question', staffNote: 'Internal showroom note', workspaceRevision: 1 } as Enquiry;
const event = (n: number) => ({ id: `note-${n}`, kind: 'conversation_logged', occurredAt: `2026-10-17T10:${String(n).padStart(2, '0')}:00Z`, staffName: 'Fictional staff', summary: 'Call recorded', note: `History note ${n}` });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ConversationHistory entry={entry} loadOnDemand /></QueryClientProvider>);
  return client;
}
beforeEach(() => { state.fetch.mockReset(); });
it('loads 25 notes first and makes every older note reachable without duplicate rows', async () => {
  state.fetch.mockImplementation(async (url: string) => url.includes('cursor=')
    ? { events: [event(1), event(26)], total: 26, nextCursor: null }
    : { events: Array.from({ length: 25 }, (_, i) => event(i + 1)), total: 26, nextCursor: 'older-page' });
  mount();
  expect(await screen.findByText('Showing 25 of 26 conversation notes.')).toBeVisible();
  expect(screen.getAllByTestId(/^conversation-/)).toHaveLength(25);
  expect(state.fetch).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Load older conversation notes' }));
  expect(await screen.findByText('History note 26')).toBeVisible();
  expect(screen.getAllByTestId(/^conversation-/)).toHaveLength(26);
  expect(screen.queryByRole('button', { name: 'Load older conversation notes' })).not.toBeInTheDocument();
  expect(state.fetch.mock.calls[1][0]).toBe('/api/staff/enquiries/fictional-enquiry/conversations?cursor=older-page');
});
it('keeps original notes visible while loading and allows retry after a history error', async () => {
  let fail!: (cause: Error) => void;
  state.fetch.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }))
    .mockResolvedValue({ events: [event(1)], total: 1, nextCursor: null });
  mount();
  expect(screen.getByRole('status')).toHaveTextContent('Loading conversation notes');
  expect(screen.getByText('Original customer question')).toBeVisible();
  expect(screen.getByText('Internal showroom note')).toBeVisible();
  fail(new Error('Fictional temporary failure'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Conversation notes could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Retry conversation notes' }));
  expect(await screen.findByText('History note 1')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('refreshes opened history when an enquiry write invalidates its existing query prefix', async () => {
  state.fetch.mockResolvedValue({ events: [], total: 0, nextCursor: null });
  const client = mount();
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
  state.fetch.mockResolvedValue({ events: [event(2)], total: 1, nextCursor: null });
  await client.invalidateQueries({ queryKey: ['/api/enquiries'] });
  expect(await screen.findByText('History note 2')).toBeVisible();
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
