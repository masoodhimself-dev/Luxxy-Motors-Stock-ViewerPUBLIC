import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('wouter', () => ({ Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
import { CustomerEmailSummary } from './customer-email-summary';

beforeEach(() => {
  state.fetch.mockReset().mockImplementation(async (url: string) => url.includes('/email-drafts')
    ? { drafts: [{ enquiryId: 'enquiry-one', status: 'draft', subject: 'Draft for Alex', updatedAt: '2026-10-16T12:00:00Z' }], hasMore: false }
    : { messages: [
      { key: 'enquiry:one', enquiry_id: 'enquiry-one', subject: 'Your viewing', status: 'sent', last_event: null, created_at: '2026-10-16T11:00:00Z' },
      { key: 'enquiry:other', enquiry_id: 'enquiry-other', subject: 'Another customer’s private email', status: 'delivered', last_event: null, created_at: '2026-10-16T11:00:00Z' },
    ], hasMore: false });
});
function mount(onPrepare = vi.fn()) {
  return { onPrepare, ...render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CustomerEmailSummary enquiryId="enquiry-one" reference="ENQ / 001" onPrepare={onPrepare} /></QueryClientProvider>) };
}

it('loads email only when opened and links it to the same enquiry without sending', async () => {
  const { onPrepare } = mount();
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare reply' }));
  expect(onPrepare).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText('Your viewing')).toBeVisible();
  expect(screen.queryByText('Another customer’s private email')).not.toBeInTheDocument();
  expect(screen.getByText(/Submitted to Resend/)).toBeVisible();
  expect(screen.queryByText(/^Delivered/)).not.toBeInTheDocument();
  expect(screen.getByText('Saved draft · not sent')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Continue draft' }));
  expect(onPrepare).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('link', { name: 'Open email workspace' })).toHaveAttribute('href', '/portal?section=notifications&workView=email&enquiryId=enquiry-one&view=sent');
  expect(state.fetch).toHaveBeenCalledWith('/api/staff/email?q=ENQ%20%2F%20001&offset=0');
  expect(state.fetch.mock.calls.every(([, options]) => !options || options.method === 'GET')).toBe(true);
});

it('does not claim an uncertain send is an unsent draft or allow it to be blindly resent', async () => {
  state.fetch.mockImplementation(async (url: string) => url.includes('/email-drafts')
    ? { drafts: [{ enquiryId: 'enquiry-one', status: 'unknown', subject: 'Unconfirmed reply', updatedAt: '2026-10-16T12:00:00Z' }], hasMore: false }
    : { messages: [], hasMore: false });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText('Acceptance unconfirmed · check before resending')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Check draft' })).toBeVisible();
  expect(screen.queryByText('Saved draft · not sent')).not.toBeInTheDocument();
});

it('shows read-tracking limits and preserves explicit delivery status', async () => {
  state.fetch.mockImplementation(async (url: string) => url.includes('/email-drafts')
    ? { drafts: [], hasMore: false }
    : { messages: [{ key: 'enquiry:one', enquiry_id: 'enquiry-one', subject: 'Your viewing', status: 'sent', last_event: 'opened', created_at: '2026-10-16T11:00:00Z' }], hasMore: false });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText(/Opened ·/)).toBeVisible();
  expect(screen.getByText(/does not prove the customer read/)).toBeVisible();
});

it('reports read failures and offers a read-only retry', async () => {
  state.fetch.mockRejectedValue(new Error('Unavailable'));
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByText('No recent email or draft recorded for this enquiry.')).not.toBeInTheDocument();
  const before = state.fetch.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry email history' }));
  await waitFor(() => expect(state.fetch.mock.calls.length).toBeGreaterThan(before));
});

it('keeps an older-draft warning when the shared draft list is truncated', async () => {
  state.fetch.mockImplementation(async (url: string) => url.includes('/email-drafts') ? { drafts: [], hasMore: true } : { messages: [], hasMore: false });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText(/Older drafts may not appear here/)).toBeVisible();
});
