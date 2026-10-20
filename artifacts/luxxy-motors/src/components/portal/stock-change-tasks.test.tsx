import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { StockChangeTask } from '@/lib/stock-change-tasks';
import { useStockChangeTasks } from '@/lib/stock-change-tasks';
import { StockChangeTasks } from './stock-change-tasks';
import { NotificationsHome } from './notifications-home';

const state = vi.hoisted(() => ({ fetch: vi.fn(), permissions: ['stock.manage'] as string[] }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('wouter', () => ({ Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('./dealer-administration', () => ({ DealerDashboard: ({ children }: any) => <div>{children}</div>, useStaffAccess: () => ({ data: { permissions: state.permissions } }) }));

function task(overrides: Partial<StockChangeTask> = {}): StockChangeTask {
  return {
    id: 'price-one', kind: 'price_drop', status: 'open', revision: 2,
    createdAt: '2026-10-20T11:00:00Z', updatedAt: '2026-10-20T11:00:00Z',
    vehicleId: 'vehicle-one', vehicleTitle: 'Toyota Yaris', registration: 'AB12CDE', imageUrl: null,
    previousPrice: 8995, currentPrice: 8495, reduction: 500, missingCount: 0,
    lastSeenAt: '2026-10-20T11:00:00Z', publiclyVisible: true, urgency: 'normal',
    affectedCustomers: [{ enquiryId: 'enquiry-one', customerName: 'Fictional Alex', email: 'alex@example.test', phone: '+44 7700 900123', preferredContact: 'phone', appointmentAt: null, appointmentStatus: null }],
    upcomingAppointments: 0, paidReservations: 0, ...overrides,
  };
}
const notifications = {
  generatedAt: '2026-10-20T11:00:00Z', emailAccess: true,
  counts: { enquiries: 1, followups: 0, appointments: 1, drafts: 1, email: 0 },
  items: [
    { id: 'enquiry-customer', category: 'enquiries', customer: 'Other enquiry', vehicle: 'Ford Focus', reference: 'hidden', at: '2026-10-20T09:00:00Z', detail: 'Awaiting a reply', href: '/portal?section=notifications&enquiryId=enquiry-customer&workView=customers' },
    { id: 'visit-customer', category: 'appointments', customer: 'Other booking', vehicle: 'Honda Civic', reference: 'hidden', at: '2026-10-20T12:00:00Z', detail: 'Appointment today', href: '/portal?section=notifications&workView=test-drives' },
  ],
};
function backend(tasks: StockChangeTask[] = [task()], notificationData = notifications) {
  state.fetch.mockImplementation(async (url: string) => url === '/api/staff/stock-change-tasks' ? { tasks, total: tasks.length, generatedAt: '2026-10-20T11:00:00Z' } : notificationData);
}
function Harness({ emailAccess = true, showEmpty = true }: { emailAccess?: boolean; showEmpty?: boolean }) {
  return <StockChangeTasks query={useStockChangeTasks()} emailAccess={emailAccess} showEmpty={showEmpty} />;
}
function show(content = <Harness />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{content}</QueryClientProvider>);
}
beforeEach(() => { state.fetch.mockReset(); state.permissions = ['stock.manage']; backend(); });

it('puts customer commitments first, shows the real price reduction and never calls a missing car sold', async () => {
  backend([task(), task({ id: 'missing-one', kind: 'missing_stock', vehicleTitle: 'Honda Civic', revision: 4, missingCount: 2, previousPrice: null, currentPrice: 6000, reduction: null, publiclyVisible: false, upcomingAppointments: 1, paidReservations: 1, createdAt: '2026-10-19T11:00:00Z' })]);
  show();
  await screen.findByText('Toyota Yaris');
  const rows = screen.getAllByTestId(/^stock-change-/);
  expect(rows.map(row => within(row).getByRole('heading', { level: 4 }).textContent)).toEqual(['Honda Civic', 'Toyota Yaris']);
  expect(within(rows[0]).getByText('Not in the latest stock update. This does not confirm it is sold.')).toBeVisible();
  expect(within(rows[0]).getByText(/Hidden from public stock/)).toBeVisible();
  expect(within(rows[0]).getByText('1 booked visit')).toBeVisible();
  expect(within(rows[0]).getByText('1 paid reservation')).toBeVisible();
  expect(within(rows[1]).getByText('£8,995').tagName).toBe('DEL');
  expect(within(rows[1]).getByText('£8,495')).toBeVisible();
  expect(within(rows[1]).getByText('Reduced by £500')).toBeVisible();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('opens the affected customers explicitly with draft-only links and sensible phone/no-email fallbacks', async () => {
  backend([task({ affectedCustomers: [...task().affectedCustomers, { enquiryId: 'no-email', customerName: 'Fictional Jo', email: null, phone: '07700900456', preferredContact: 'phone', appointmentAt: '2026-10-22T10:00:00Z', appointmentStatus: 'confirmed' }] })]);
  show();
  const button = await screen.findByRole('button', { name: 'Review interested customers' });
  expect(screen.queryByText('Fictional Alex')).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('link', { name: 'Prepare email draft' })).toHaveAttribute('href', '/portal?section=notifications&workView=email&compose=enquiry-one&stockChangeId=price-one');
  expect(screen.getByText(/Existing bookings, agreed prices and payments stay unchanged/)).toBeVisible();
  const customers = screen.getByRole('list', { name: 'Customers affected by Toyota Yaris' });
  const jo = within(customers).getByRole('link', { name: 'Fictional Jo' }).closest('li')!;
  expect(within(jo).getByText('No email address')).toBeVisible();
  expect(within(jo).queryByRole('link', { name: 'Prepare email draft' })).not.toBeInTheDocument();
  expect(within(jo).getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:07700900456');
  expect(within(jo).getByText(/Visit 22 Oct 2026, 11:00/)).toBeVisible();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('does not expose compose actions to staff without email access', async () => {
  show(<Harness emailAccess={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review interested customers' }));
  expect(screen.queryByRole('link', { name: 'Prepare email draft' })).not.toBeInTheDocument();
  expect(screen.getByText('Email access required')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Call' })).toBeVisible();
});

it('marks only the selected task reviewed with its revision, without stock, sales or email mutations', async () => {
  let reviewed = false;
  state.fetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') { reviewed = true; return { ...task(), status: 'reviewed', revision: 3 }; }
    return { tasks: reviewed ? [] : [task()], total: reviewed ? 0 : 1, generatedAt: '2026-10-20T11:00:00Z' };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
  expect(await screen.findByText('No stock changes need review.')).toBeVisible();
  expect(screen.getByText(/Toyota Yaris marked reviewed. Stock and customer commitments are unchanged./)).toBeVisible();
  const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe('/api/staff/stock-change-tasks/price-one');
  expect(JSON.parse(writes[0][1].body)).toEqual({ expectedRevision: 2, action: 'reviewed' });
});

it('refreshes a revision conflict and requires another staff click before retrying the newer task', async () => {
  let revision = 2;
  state.fetch.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') { revision = 3; throw { status: 409 }; }
    return { tasks: [task({ revision })], total: 1, generatedAt: '2026-10-20T11:00:00Z' };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This stock change has been updated');
  await waitFor(() => expect(state.fetch.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(2));
  expect(state.fetch.mock.calls.filter(([, options]) => options?.method)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
  await waitFor(() => expect(state.fetch.mock.calls.filter(([, options]) => options?.method)).toHaveLength(2));
  const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
  expect(JSON.parse(writes[1][1].body)).toEqual({ expectedRevision: 3, action: 'reviewed' });
});

it('keeps task review writes unavailable without stock management permission', async () => {
  state.permissions = [];
  show();
  await screen.findByText('Toyota Yaris');
  expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open car' })).toBeVisible();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('filters Home to stock work without unrelated customer/booking sections or a false all-clear', async () => {
  show(<NotificationsHome />);
  fireEvent.click(await screen.findByRole('button', { name: 'Stock changes 1' }));
  expect(screen.getByRole('region', { name: 'Stock changes' })).toBeVisible();
  expect(screen.queryByRole('region', { name: 'Customers to contact' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Today’s appointments' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Open saved drafts/ })).not.toBeInTheDocument();
  expect(screen.queryByText('You’re up to date')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All work' }));
  expect(screen.getByRole('link', { name: /Other enquiry/ })).toBeVisible();
});

it('shows stock loading independently of customer work and retries a stock error without reporting success', async () => {
  let fail!: (error: Error) => void;
  state.fetch.mockImplementation((url: string) => url === '/api/staff/stock-change-tasks' ? new Promise((_, reject) => { fail = reject; }) : Promise.resolve({ ...notifications, counts: { enquiries: 0, followups: 0, appointments: 0, drafts: 0, email: 0 }, items: [] }));
  show(<NotificationsHome />);
  expect(await screen.findByText('Checking stock changes…')).toBeVisible();
  expect(await screen.findByRole('region', { name: 'Customers to contact' })).toBeVisible();
  expect(screen.queryByText('You’re up to date')).not.toBeInTheDocument();
  fail(new Error('offline'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Stock changes could not be refreshed');
  expect(screen.queryByText('You’re up to date')).not.toBeInTheDocument();
  backend([task()]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry stock changes' }));
  expect(await screen.findByText('Toyota Yaris')).toBeVisible();
});

it('preserves stock tasks when notifications fail and does not mistake an unknown email permission for approval', async () => {
  const stock = { tasks: [task()], total: 1, generatedAt: '2026-10-20T11:00:00Z' };
  state.fetch.mockImplementation((url: string) => url === '/api/staff/stock-change-tasks' ? Promise.resolve(stock) : Promise.reject(new Error('offline')));
  show(<NotificationsHome />);
  await screen.findByText('Toyota Yaris');
  fireEvent.click(screen.getByRole('button', { name: 'Review interested customers' }));
  expect(screen.getByText('Email access required')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Prepare email draft' })).not.toBeInTheDocument();
});

it('caps the initial task list and expands it only when requested', async () => {
  backend(Array.from({ length: 6 }, (_, index) => task({ id: `task-${index}`, vehicleTitle: `Car ${index}` })));
  show();
  await screen.findByText('Car 0');
  expect(screen.getAllByTestId(/^stock-change-/)).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Show all 6 stock changes' }));
  expect(screen.getAllByTestId(/^stock-change-/)).toHaveLength(6);
  expect(screen.getByRole('button', { name: 'Show fewer stock changes' })).toHaveAttribute('aria-expanded', 'true');
});

it('keeps an unreviewed task visible after a failed write and explains the server page limit honestly', async () => {
  state.fetch.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method === 'PATCH') throw { status: 503 };
    return { tasks: [task()], total: 101, generatedAt: '2026-10-20T11:00:00Z' };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not mark this stock change reviewed');
  expect(screen.getByText('Toyota Yaris')).toBeVisible();
  expect(screen.getByText('Showing 1 of 101 open stock changes. Review these to load older changes.')).toBeVisible();
  expect(screen.queryByText('No stock changes need review.')).not.toBeInTheDocument();
});

it('links standalone paid commitments to vehicle history without inventing an email enquiry or claiming nobody is affected', async () => {
  backend([task({ kind: 'missing_stock', currentPrice: 6200, previousPrice: null, reduction: null, affectedCustomers: [], paidReservations: 1, publiclyVisible: false })]);
  show();
  expect(await screen.findByRole('link', { name: 'Review bookings & payments' })).toHaveAttribute('href', '/portal?section=history&view=vehicles&vehicleId=vehicle-one');
  expect(screen.getByText('Open vehicle history to review the linked bookings and payments.')).toBeVisible();
  expect(screen.getByText('1 paid reservation')).toBeVisible();
  expect(screen.queryByText('0 customers to review')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Prepare email draft' })).not.toBeInTheDocument();
  expect(screen.queryByText('£6,200')).not.toBeInTheDocument();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('keeps the bookings and payments history link available alongside interested customers for an upcoming visit', async () => {
  backend([task({ upcomingAppointments: 1 })]);
  show();
  expect(await screen.findByRole('link', { name: 'Review bookings & payments' })).toHaveAttribute('href', '/portal?section=history&view=vehicles&vehicleId=vehicle-one');
  expect(screen.getByRole('button', { name: 'Review interested customers' })).toBeVisible();
});
