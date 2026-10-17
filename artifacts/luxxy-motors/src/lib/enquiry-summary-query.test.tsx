import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
const state = vi.hoisted(() => ({ hook: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  getGetEnquiriesQueryKey: (params?: unknown) => params ? ['/api/enquiries', params] : ['/api/enquiries'],
  useGetEnquiries: (...args: unknown[]) => state.hook(...args),
}));
import { enquirySummaryKey, useEnquirySummaries } from './enquiry-summary-query';
beforeEach(() => { state.hook.mockReset().mockReturnValue({ data: [] }); });
it('keeps summaries separate from full timelines while preserving request options', () => {
  useEnquirySummaries(undefined, { request: { headers: { 'X-Test': 'kept' }, credentials: 'same-origin' } });
  const [, options] = state.hook.mock.calls[0];
  expect(options.query.queryKey).toEqual(['/api/enquiries', 'timeline-omitted']);
  expect(options.request.headers.get('X-Enquiry-Timeline')).toBe('omit');
  expect(options.request.headers.get('X-Test')).toBe('kept');
  expect(options.request.credentials).toBe('same-origin');
  useEnquirySummaries(undefined, { query: { queryKey: ['case-list', 'owner'] } });
  expect(state.hook.mock.calls[1][1].query.queryKey).toEqual(['case-list', 'owner', 'timeline-omitted']);
  expect(enquirySummaryKey(['/api/enquiries', 'timeline-omitted'])).toEqual(['/api/enquiries', 'timeline-omitted']);
});
it('one existing enquiry invalidation refreshes full, summary and conversation caches', async () => {
  const client = new QueryClient();
  const keys = [['/api/enquiries'], enquirySummaryKey(), ['/api/enquiries', 'conversations', 'fictional-enquiry', 1]];
  for (const key of keys) client.setQueryData(key, { fixture: true });
  client.setQueryData(['other-workspace'], { fixture: true });
  await client.invalidateQueries({ queryKey: ['/api/enquiries'] });
  for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(['other-workspace'])?.isInvalidated).toBe(false);
});
