import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useVehicleWatchTasks, type VehicleWatchTask } from '@/lib/vehicle-watch-tasks';
import { VehicleWatchTasks } from './vehicle-watch-tasks';
import { NotificationsHome } from './notifications-home';
const state = vi.hoisted(() => ({ fetch: vi.fn(), permissions: ['sales.manage'] as string[] }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('./sale-handover', () => ({ DeliveryHomeTasks: () => null }));
vi.mock('wouter', () => ({ Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('./dealer-administration', () => ({ DealerDashboard: ({ children }: any) => <div>{children}</div>, useStaffAccess: () => ({ data: { permissions: state.permissions } }) }));
const task = (changes: Partial<VehicleWatchTask> = {}): VehicleWatchTask => ({ id: 'watch-task', vehicleId: 'car-one', vehicleTitle: 'Ford Focus', vehicleUrl: 'https://dealer.example.test/vehicle/car-one', kind: 'price_drop', revision: 2, previousPrice: 9000, currentPrice: 8500, createdAt: '2026-10-25T10:00:00Z', subject: 'The Ford Focus has been reduced', message: 'The Ford Focus is now £8,500. View the car or book a test drive.', recipients: [{ id: 'watch-one', email: 'alex@example.test', status: 'pending', sentAt: null }, { id: 'watch-two', email: 'jo@example.test', status: 'pending', sentAt: null }], pendingCount: 2, totalCount: 2, ...changes });
function backend(tasks = [task()]) {
  state.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method) {
      const content = JSON.parse(options.body as string);
      if (url.endsWith('/preview')) return { subject: content.subject, message: content.message, recipients: tasks.flatMap(row => row.recipients).filter(recipient => content.watchIds.includes(recipient.id)), previewHash: 'fresh-preview', expectedRevision: content.expectedRevision, ready: true };
      if (url.endsWith('/send')) return { sentCount: content.watchIds.length, skippedCount: 0, failedCount: 0, uncertainCount: 0, message: 'The selected emails were submitted.' };
    }
    if (url === '/api/staff/vehicle-watch-tasks') return { tasks, total: tasks.length };
    if (url === '/api/staff/vehicle-watch-counts') return { counts: [{ vehicleId: 'car-one', count: 2 }] };
    if (url === '/api/staff/stock-change-tasks' || url === '/api/staff/sold-vehicle-follow-ups') return { tasks: [], total: 0 };
    return { generatedAt: '2026-10-25T10:00:00Z', emailAccess: true, counts: { enquiries: 1, followups: 0, appointments: 0, drafts: 0, email: 0 }, items: [{ id: 'other', enquiryId: 'other', category: 'enquiries', customer: 'Other customer', vehicle: 'Honda Civic', reference: 'ENQ', at: '2026-10-25T09:00:00Z', detail: 'Awaiting reply', href: '/portal?section=notifications&enquiryId=other' }] };
  });
}
function Harness() { return <VehicleWatchTasks query={useVehicleWatchTasks()} showEmpty />; }
function show(content = <Harness />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{content}</QueryClientProvider>);
}
const writes = () => state.fetch.mock.calls.filter(([, options]) => options?.method);
async function open() { fireEvent.click(await screen.findByRole('button', { name: 'Review update' })); return screen.getByRole('dialog'); }
async function prepare() { const dialog = await open(); fireEvent.click(within(dialog).getByRole('button', { name: 'Select first 2' })); fireEvent.click(within(dialog).getByRole('button', { name: 'Preview selected emails' })); await within(dialog).findByRole('region', { name: 'Email preview' }); return dialog; }
beforeEach(() => { state.fetch.mockReset(); state.permissions = ['sales.manage']; backend(); });
it('groups a real price change with watchers, without creating enquiries or sending on load', async () => {
  show();
  expect(await screen.findByText('Ford Focus')).toHaveAttribute('href', '/portal?section=inventory&vehicleId=car-one');
  expect(screen.getByText('£9,000').tagName).toBe('DEL');
  expect(screen.getByText('£8,500')).toBeVisible();
  expect(screen.getByText('2 customers to update · 2 watching')).toBeVisible();
  expect(screen.getByText(/Sending stays manual/)).toBeVisible();
  expect(writes()).toHaveLength(0);
});
it('requires selected verified recipients and a checked preview before an explicit send', async () => {
  show(); const dialog = await open();
  expect(within(dialog).getByRole('button', { name: 'Preview selected emails' })).toBeDisabled();
  expect(within(dialog).queryByRole('button', { name: /^Send/ })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select alex@example.test' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview selected emails' }));
  expect(await within(dialog).findByRole('region', { name: 'Email preview' })).toHaveTextContent(task().message);
  expect(writes()).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send 1 email' }));
  expect(await within(dialog).findByText('1 email submitted')).toBeVisible();
  const send = writes().find(([url]) => url.endsWith('/send'))!;
  expect(JSON.parse(send[1].body)).toEqual({ expectedRevision: 2, subject: task().subject, message: task().message, watchIds: ['watch-one'], previewHash: 'fresh-preview', requestId: expect.any(String) });
  expect(within(dialog).getByText(/Other watchers’ addresses are not included/)).toBeVisible();
});
it('invalidates a preview whenever the wording or selected recipients change', async () => {
  show(); const dialog = await prepare();
  fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'A staff-edited message.' } });
  expect(within(dialog).queryByRole('region', { name: 'Email preview' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Send 2 emails' })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview selected emails' }));
  await within(dialog).findByRole('region', { name: 'Email preview' });
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select jo@example.test' }));
  expect(within(dialog).queryByRole('region', { name: 'Email preview' })).not.toBeInTheDocument();
  expect(within(dialog).getByLabelText('Message')).toHaveValue('A staff-edited message.');
  expect(writes().every(([url]) => url.endsWith('/preview'))).toBe(true);
});
it('limits a batch to 20 and does not select sent or unconfirmed attempts', async () => {
  const recipients = Array.from({ length: 22 }, (_, index) => ({ id: `watch-${index}`, email: `customer-${index}@example.test`, status: 'pending' as const, sentAt: null }));
  backend([task({ recipients: [...recipients, { id: 'sent', email: 'sent@example.test', status: 'sent', sentAt: '2026-10-25T10:00:00Z' }, { id: 'unknown', email: 'unknown@example.test', status: 'uncertain', sentAt: null }], pendingCount: 22, totalCount: 24 })]);
  show(); const dialog = await open();
  expect(within(dialog).getByRole('checkbox', { name: 'Select sent@example.test' })).toBeDisabled();
  expect(within(dialog).getByRole('checkbox', { name: 'Select unknown@example.test' })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Select first 20' }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select customer-21@example.test' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('up to 20');
  expect(within(dialog).getAllByRole('checkbox').filter(input => (input as HTMLInputElement).checked)).toHaveLength(20);
});
it('preserves staff wording when the server rejects an outdated event', async () => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options?: RequestInit) => { if (url.endsWith('/preview')) throw { status: 409 }; return normal(url, options); });
  show(); const dialog = await open();
  fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'Please call us to discuss this car.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Select first 2' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview selected emails' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Your wording is kept');
  expect(within(dialog).getByLabelText('Message')).toHaveValue('Please call us to discuss this car.');
  expect(within(dialog).queryByRole('button', { name: 'Send 2 emails' })).not.toBeInTheDocument();
});
it('does not enable Send if the verified preview differs from the selected customer list', async () => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options?: RequestInit) => url.endsWith('/preview') ? { subject: task().subject, message: task().message, recipients: [{ id: 'other-customer', email: 'other@example.test' }], expectedRevision: 2, previewHash: 'wrong', ready: true } : normal(url, options));
  show(); const dialog = await open();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Select first 2' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Preview selected emails' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('recipient list changed');
  expect(within(dialog).queryByRole('button', { name: 'Send 2 emails' })).not.toBeInTheDocument();
});
it('checks an uncertain network result with the same request rather than creating a duplicate send', async () => {
  const normal = state.fetch.getMockImplementation()!; let attempts = 0;
  state.fetch.mockImplementation(async (url: string, options?: RequestInit) => { if (url.endsWith('/send') && ++attempts === 1) throw new Error('connection lost'); return normal(url, options); });
  show(); const dialog = await prepare();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send 2 emails' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Do not start another batch');
  expect(within(dialog).getByLabelText('Message')).toBeDisabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Check send result' }));
  expect(await within(dialog).findByText('2 emails submitted')).toBeVisible();
  const attemptsSent = writes().filter(([url]) => url.endsWith('/send')).map(([, options]) => JSON.parse(options.body));
  expect(attemptsSent).toHaveLength(2); expect(attemptsSent[0]).toEqual(attemptsSent[1]);
});
it('shows connection readiness failures without a send button', async () => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options?: RequestInit) => { const response = await normal(url, options); return url.endsWith('/preview') ? { ...response, ready: false } : response; });
  show(); const dialog = await prepare();
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Email is not ready');
  expect(within(dialog).queryByRole('button', { name: 'Send 2 emails' })).not.toBeInTheDocument();
});
it('keeps contact actions unavailable without the existing sales permission', async () => {
  state.permissions = []; show();
  expect(await screen.findByText('Customer contact permission required')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Review update' })).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});
it('keeps watch updates separate from enquiries on Home', async () => {
  show(<NotificationsHome />);
  fireEvent.click(await screen.findByRole('button', { name: /Watch updates 1/ }));
  expect(screen.getByRole('button', { name: /Watch updates 1/ })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Ford Focus')).toBeVisible();
  expect(screen.queryByText('Other customer')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All work' }));
  expect(screen.getByText('Other customer')).toBeVisible();
  expect(writes()).toHaveLength(0);
});
it('retries a failed load and shows the real empty state', async () => {
  state.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ tasks: [], total: 0 });
  show(); fireEvent.click(await screen.findByRole('button', { name: 'Retry watch updates' }));
  expect(await screen.findByText('No watch updates need review.')).toBeVisible();
});
it('asks before discarding edited wording and does not write when closing', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  show(); const dialog = await open();
  fireEvent.change(within(dialog).getByLabelText('Email subject'), { target: { value: 'A revised subject' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close review' }));
  expect(confirm).toHaveBeenCalled(); expect(screen.getByRole('dialog')).toBeVisible();
  expect(writes()).toHaveLength(0); confirm.mockRestore();
});
