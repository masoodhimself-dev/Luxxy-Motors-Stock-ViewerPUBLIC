import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { customFetch } from '@workspace/api-client-react';
import { DealerReports } from './dealer-reports';

vi.mock('@workspace/api-client-react', async original => ({ ...await original<object>(), customFetch: vi.fn() }));

it('loads only isolated test-session reports, never the live report endpoint', async () => {
  vi.mocked(customFetch).mockResolvedValue({ period:'30d',from:'2026-09-27T10:00:00Z',to:'2026-10-27T10:00:00Z',enquiries:{received:2,newNow:2},bookings:{scheduled:1,pending:0},sales:{completed:1},popularVehicles:[] } as never);
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><DealerReports scope="dealer" testSessionId="session-123" /></QueryClientProvider>);
  expect(await screen.findByText(/Showing this test/)).toBeVisible();
  expect(await screen.findByText(/Based on records in this test only/)).toBeVisible();
  expect(vi.mocked(customFetch).mock.calls.map(([url])=>url)).toEqual(['/api/sales-test/sessions/session-123/reports?period=30d']);
});
