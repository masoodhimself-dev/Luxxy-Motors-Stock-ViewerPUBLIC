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
      { key: 'enquiry:child', enquiry_id: 'enquiry-merged-child', subject: 'Reply from the merged enquiry', status: 'delivered', last_event: null, created_at: '2026-10-16T10:00:00Z' },
    ], hasMore: false });
});
function mount(onPrepare = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (enquiryId: string) => <QueryClientProvider client={client}><CustomerEmailSummary enquiryId={enquiryId} reference="ENQ / 001" onPrepare={onPrepare} /></QueryClientProvider>;
  const rendered = render(content('enquiry-one'));
  return { onPrepare, client, ...rendered, showEnquiry: (id: string) => rendered.rerender(content(id)) };
}

it('loads email only when opened and links it to the same enquiry without sending', async () => {
  const { onPrepare } = mount();
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare reply' }));
  expect(onPrepare).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText('Your viewing')).toBeVisible();
  expect(screen.getByText('Reply from the merged enquiry')).toBeVisible();
  expect(screen.getByText(/Submitted to Resend/)).toBeVisible();
  expect(screen.getByText(/^Delivered/)).toBeVisible();
  expect(screen.getByText('Saved draft · not sent')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Continue draft' }));
  expect(onPrepare).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', '/portal?section=notifications&workView=email&enquiryId=enquiry-one&view=sent');
  expect(state.fetch).toHaveBeenCalledWith('/api/staff/email?enquiryId=enquiry-one&offset=0');
  expect(state.fetch).toHaveBeenCalledWith('/api/staff/email-drafts?enquiryId=enquiry-one');
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

it('keeps an older-draft warning when this case’s draft list is truncated', async () => {
  state.fetch.mockImplementation(async (url: string) => url.includes('/email-drafts') ? { drafts: [], hasMore: true } : { messages: [], hasMore: false });
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText(/Older drafts may not appear here/)).toBeVisible();
});

it('opens a merged case draft on its original enquiry rather than preparing the wrong customer record', async () => {
  state.fetch.mockImplementation(async (url: string) => url.includes('/email-drafts')
    ? { drafts: [{ enquiryId: 'enquiry-merged-child', status: 'draft', subject: 'Saved before the merge', updatedAt: '2026-10-16T12:00:00Z' }], hasMore: false }
    : { messages: [], hasMore: false });
  const { onPrepare } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText('Saved before the merge')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Continue draft' })).toHaveAttribute('href', '/portal?section=notifications&workView=email&enquiryId=enquiry-merged-child&draft=enquiry-merged-child');
  expect(onPrepare).not.toHaveBeenCalled();
  expect(state.fetch.mock.calls.every(([, options]) => !options || options.method === 'GET')).toBe(true);
});

it('prefers the current enquiry’s draft when the explicit case contains several drafts', async () => {
  state.fetch.mockImplementation(async (url: string) => url.includes('/email-drafts')
    ? { drafts: [
      { enquiryId: 'enquiry-merged-child', status: 'draft', subject: 'Merged child draft', updatedAt: '2026-10-16T13:00:00Z' },
      { enquiryId: 'enquiry-one', status: 'draft', subject: 'Current enquiry draft', updatedAt: '2026-10-16T12:00:00Z' },
    ], hasMore: false }
    : { messages: [], hasMore: false });
  const { onPrepare } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText('Current enquiry draft')).toBeVisible();
  expect(screen.queryByText('Merged child draft')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Continue draft' }));
  expect(onPrepare).toHaveBeenCalledOnce();
});

it('keeps cached emails and drafts separate when switching enquiries with the same reference text', async () => {
  state.fetch.mockImplementation(async (url: string) => {
    const id = new URL(url, 'https://example.test').searchParams.get('enquiryId');
    return url.includes('/email-drafts')
      ? { drafts: [{ enquiryId: id, status: 'draft', subject: `Draft ${id}`, updatedAt: '2026-10-16T12:00:00Z' }], hasMore: false }
      : { messages: [{ key: `email:${id}`, enquiry_id: id, subject: `Email ${id}`, status: 'sent', last_event: null, created_at: '2026-10-16T11:00:00Z' }], hasMore: false };
  });
  const { showEnquiry, client } = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Show email history' }));
  expect(await screen.findByText('Email enquiry-one')).toBeVisible();
  showEnquiry('enquiry-two');
  expect(await screen.findByText('Email enquiry-two')).toBeVisible();
  expect(screen.getByText('Draft enquiry-two')).toBeVisible();
  expect(screen.queryByText('Email enquiry-one')).not.toBeInTheDocument();
  expect(screen.queryByText('Draft enquiry-one')).not.toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledWith('/api/staff/email?enquiryId=enquiry-two&offset=0');
  expect(state.fetch).toHaveBeenCalledWith('/api/staff/email-drafts?enquiryId=enquiry-two');
  expect(client.getQueryData(['staff-email', '', 0, 'enquiry-one'])).toBeDefined();
  expect(client.getQueryData(['staff-email-drafts', 'enquiry-one'])).toBeDefined();
});
