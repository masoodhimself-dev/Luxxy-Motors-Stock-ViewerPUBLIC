import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SoldVehicleCustomerReview, SoldVehicleFollowUpTasks } from './sold-vehicle-customer-review';
import { useSoldVehicleFollowUps, type SoldVehicleCustomer, type SoldVehicleFollowUpReview } from '@/lib/sold-vehicle-follow-ups';
const state = vi.hoisted(() => ({ fetch: vi.fn(), permissions: ['sales.manage'] as string[], compose: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('wouter', () => ({ Link: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }));
vi.mock('./dealer-administration', () => ({ useStaffAccess: () => ({ data: { permissions: state.permissions } }) }));
vi.mock('./sold-vehicle-email-composer', () => ({ SoldVehicleEmailComposer: (props: any) => { state.compose(props); return <div role="dialog" aria-label="Review email"><p>{props.entry.customerName}</p><button onClick={() => props.onClose('draft')}>Save and return</button></div>; } }));
function customer(overrides: Partial<SoldVehicleCustomer> = {}): SoldVehicleCustomer {
  return { enquiryId: 'alex', customerName: 'Fictional Alex', email: 'alex@example.test', phone: '+447700900123', preferredContact: 'phone',
    kind: 'appointment', appointmentAt: '2026-10-22T10:00:00Z', appointmentRevision: 3, appointmentCancelledAt: null,
    status: 'pending', revision: 1, cancelledByReview: false, contactedAt: null, outcome: null, emailStatus: null, urgent: true,
    appointments: [{ enquiryId: 'alex', at: '2026-10-22T10:00:00Z', revision: 3, cancelledAt: null }], ...overrides };
}
function review(overrides: Partial<SoldVehicleFollowUpReview> = {}): SoldVehicleFollowUpReview {
  return { saleId: 'sale-one', vehicleId: 'car-one', vehicleTitle: 'Toyota Yaris', registration: 'AB12CDE', imageUrl: null,
    sold: true, createdAt: '2026-10-20T11:00:00Z', remaining: 2, upcomingAppointments: 1,
    customers: [customer(), customer({ enquiryId: 'jo', customerName: 'Fictional Jo', kind: 'interest', appointmentAt: null, appointments: [], urgent: false })], ...overrides };
}
let current: SoldVehicleFollowUpReview;
function Harness() { return <SoldVehicleFollowUpTasks query={useSoldVehicleFollowUps()} showEmpty />; }
function show(content = <SoldVehicleCustomerReview saleId="sale-one" />) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{content}</QueryClientProvider>);
}
beforeEach(() => {
  current = review(); state.permissions = ['sales.manage']; state.fetch.mockReset(); state.compose.mockReset();
  state.fetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === '/api/staff/sold-vehicle-follow-ups') return { tasks: current.remaining ? [current] : [], total: current.remaining ? 1 : 0, generatedAt: '2026-10-20T11:00:00Z' };
    if (!options?.method) return structuredClone(current);
    const id = decodeURIComponent(path.split('/').at(-1)!); const row = current.customers.find(item => item.enquiryId === id)!;
    const data = JSON.parse(options.body as string);
    if (data.action === 'cancel_appointment') { row.cancelledByReview = true; row.appointmentCancelledAt = '2026-10-20T11:02:00Z'; row.appointments?.forEach(item => { item.cancelledAt = row.appointmentCancelledAt; item.revision += 1; }); row.revision += 1; }
    else { row.status = data.outcome === 'not_needed' ? 'not_needed' : 'contacted'; row.outcome = data.outcome; row.revision += 1; current.remaining -= 1; }
    return structuredClone(current);
  });
});

it('previews affected customers before sold without cancelling or preparing messages', async () => {
  current.sold = false; show();
  expect(await screen.findByRole('heading', { name: 'Other customers interested in this car' })).toBeVisible();
  expect(screen.getByText('Fictional Alex')).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Cancel selected/ })).not.toBeInTheDocument();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  expect(state.compose).not.toHaveBeenCalled();
});

it('requires explicit cancellation confirmation and then opens an editable email without sending', async () => {
  show(); await screen.findByText('Fictional Alex');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel selected & prepare emails' }));
  expect(state.fetch.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  expect(screen.getByRole('group', { name: 'Confirm appointment cancellations' })).toHaveTextContent('Fictional Alex');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation of 1 customer’s visits' }));
  expect(await screen.findByRole('dialog', { name: 'Review email' })).toBeVisible();
  const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
  expect(writes).toHaveLength(1);
  expect(writes[0][0]).toBe('/api/staff/sold-vehicle-follow-ups/sale-one/customers/alex');
  expect(JSON.parse(writes[0][1].body)).toEqual({ action: 'cancel_appointment', expectedRevision: 1, expectedAppointmentRevision: 3, expectedAppointments: [{ enquiryId: 'alex', expectedRevision: 3 }] });
  expect(state.compose.mock.calls.at(-1)?.[0].saleId).toBe('sale-one');
  fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('Appointment cancelled — contact customer')).toBeVisible();
  expect(current.remaining).toBe(2);
});

it('cancels only selected customers and preserves all linked booking revisions', async () => {
  current.customers.push(customer({ enquiryId: 'sam', customerName: 'Fictional Sam' }));
  current.customers[0].appointments!.push({ enquiryId: 'alex-second', at: '2026-10-23T10:00:00Z', revision: 8, cancelledAt: null });
  show(); await screen.findByText('Fictional Alex');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Fictional Sam for cancellation' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel selected — I’ll call' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation of 1 customer’s visits' }));
  await screen.findByText(/1 customer’s appointment cancelled/);
  const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body).expectedAppointments).toEqual([{ enquiryId: 'alex', expectedRevision: 3 }, { enquiryId: 'alex-second', expectedRevision: 8 }]);
  expect(state.compose).not.toHaveBeenCalled();
  expect(current.customers.find(row => row.enquiryId === 'sam')?.cancelledByReview).toBe(false);
});

it('keeps phone follow-ups outstanding until staff explicitly record the conversation', async () => {
  current.customers[0] = customer({ email: null }); show(); await screen.findByText('Fictional Alex');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel selected — I’ll call' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation of 1 customer’s visits' }));
  const alex = screen.getByRole('link', { name: 'Fictional Alex' }).closest('li')!;
  const done = await within(alex).findByRole('button', { name: 'I’ve spoken to them' });
  expect(current.remaining).toBe(2);
  expect(screen.getAllByRole('link', { name: 'Call customer' })[0]).toHaveAttribute('href', 'tel:+447700900123');
  expect(screen.queryByRole('button', { name: 'Review cancellation email' })).not.toBeInTheDocument();
  fireEvent.click(done);
  expect(await within(alex).findByText('Contact recorded by phone')).toBeVisible();
  expect(current.remaining).toBe(1);
  const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
  expect(JSON.parse(writes.at(-1)![1].body)).toEqual({ action: 'complete', expectedRevision: 2, outcome: 'phone' });
});

it('keeps interested-customer updates optional and never closes the underlying enquiry', async () => {
  show(); await screen.findByText('Fictional Alex');
  const interests = screen.getByText('Other interested customers').closest('details')!;
  fireEvent.click(within(interests).getByText('Other interested customers'));
  fireEvent.click(within(interests).getByRole('button', { name: 'Update not needed' }));
  expect(await screen.findByText('Optional update marked not needed. The enquiry stays open.')).toBeVisible();
  const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body)).toEqual({ action: 'complete', expectedRevision: 1, outcome: 'not_needed' });
  expect(state.compose).not.toHaveBeenCalled();
});

it('refreshes conflicts without claiming the appointment was cancelled', async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation((path: string, options?: RequestInit) => options?.method ? Promise.reject({ status: 409 }) : original(path, options));
  show(); await screen.findByText('Fictional Alex');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel selected — I’ll call' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm cancellation of 1 customer’s visits' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('updated by someone else');
  expect(screen.queryByText('Appointment cancelled — contact customer')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel appointment…' })).toBeEnabled();
});

it('shows unresolved work from Home after reopening without automatic writes', async () => {
  show(<Harness />);
  const button = await screen.findByRole('button', { name: 'Review customers' });
  expect(screen.getByText(/2 customers to update/)).toBeVisible();
  fireEvent.click(button);
  expect(await screen.findByText('Fictional Alex')).toBeVisible();
  expect(screen.getByText('Call before they travel')).toBeVisible();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});

it('hides write actions from staff without sale management permission', async () => {
  state.permissions = ['stock.manage']; show(); await screen.findByText('Fictional Alex');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel appointment…' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Update not needed' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Call customer' })[0]).toBeVisible();
});

it('keeps changed customer records visible and requires a note for explicit manual resolution', async () => {
  current.customers[0] = customer({ blockedReason: 'This customer was merged into another record.', email: null, appointments: [], appointmentCancelledAt: '2026-10-20T11:00:00Z', cancelledByReview: true });
  show(); await screen.findByText('Fictional Alex');
  expect(screen.getByText(/This customer was merged/)).toBeVisible();
  const row = screen.getByRole('link', { name: 'Fictional Alex' }).closest('li')!;
  const button = within(row).getByRole('button', { name: 'Record handled elsewhere' });
  expect(button).toBeDisabled();
  fireEvent.change(within(row).getByRole('textbox', { name: 'Resolution note for Fictional Alex' }), { target: { value: 'Called from the linked customer record.' } });
  fireEvent.click(button);
  await screen.findByText('Follow-up reviewed with your note. No customer contact has been claimed.');
  const write = state.fetch.mock.calls.find(([, options]) => options?.method)!;
  expect(JSON.parse(write[1].body)).toEqual({ action: 'complete', expectedRevision: 1, outcome: 'not_needed', note: 'Called from the linked customer record.' });
});

it('recovers a previously submitted email without preparing or sending a second copy', async () => {
  current.customers[0] = customer({ cancelledByReview: true, appointmentCancelledAt: '2026-10-20T11:00:00Z', appointments: [{ enquiryId: 'alex', at: '2026-10-22T10:00:00Z', revision: 4, cancelledAt: '2026-10-20T11:00:00Z' }], emailStatus: 'sent' });
  show(); await screen.findByText('Fictional Alex');
  const row = screen.getByRole('link', { name: 'Fictional Alex' }).closest('li')!;
  expect(within(row).queryByRole('button', { name: 'Review cancellation email' })).not.toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: 'Email already submitted — finish follow-up' }));
  expect(await screen.findByText('The existing email submission has been confirmed. No second email was sent.')).toBeVisible();
  const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body)).toEqual({ action: 'complete', expectedRevision: 1, outcome: 'email' });
  expect(state.compose).not.toHaveBeenCalled();
});

it('keeps an expired uncancelled visit actionable without offering an impossible cancellation', async () => {
  current.customers = [customer({ appointmentAt: '2020-01-01T10:00:00Z', appointments: [{ enquiryId: 'alex', at: '2020-01-01T10:00:00Z', revision: 3, cancelledAt: null }], urgent: false })];
  current.remaining = 1; current.upcomingAppointments = 0;
  show(); await screen.findByText('Fictional Alex');
  expect(screen.getByText('Visit time has passed — contact customer')).toBeVisible();
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel appointment…' })).not.toBeInTheDocument();
  expect(screen.queryByText('Appointment cancelled — contact customer')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Prepare sold update' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'I’ve spoken to them' }));
  expect(await screen.findByText('Contact recorded by phone')).toBeVisible();
  const writes = state.fetch.mock.calls.filter(([, options]) => options?.method);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body).action).toBe('complete');
});
