import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
import { useDealerFeatures } from './dealer-features';
beforeEach(() => { state.fetch.mockReset(); });
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(useDealerFeatures, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
it('requires explicit true and safely disables malformed feature responses', async () => {
  state.fetch.mockResolvedValue({ messages: [] });
  const { result } = mount();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.enabled('customerEmails')).toBe(false);
  expect(result.current.enabled('testDriveDeclarations')).toBe(false);
});
it('fails closed when a refresh fails even if an older enabled response remains cached', async () => {
  state.fetch.mockResolvedValue({ features: { customerEmails: true }, evaluatedAt: '2026-10-18T10:00:00Z' });
  const { result } = mount();
  await waitFor(() => expect(result.current.enabled('customerEmails')).toBe(true));
  state.fetch.mockRejectedValue(new Error('Unavailable'));
  await act(async () => { await result.current.refetch({ throwOnError: false }); });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.data?.features.customerEmails).toBe(true);
  expect(result.current.isError).toBe(true);
  expect(result.current.enabled('customerEmails')).toBe(false);
});
