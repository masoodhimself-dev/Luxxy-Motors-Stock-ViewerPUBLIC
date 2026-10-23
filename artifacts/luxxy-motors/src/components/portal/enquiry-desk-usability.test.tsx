import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
import { TodayDesk } from './enquiry-workspace-tools';
import { EnquiryRecordBrowser, type EnquiryRecordActions } from './enquiry-record-browser';
import type { Car } from '@/lib/stock-context';
import { DealerDashboard } from './dealer-administration';

const workspaceMutation = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...await importOriginal<object>(),
  customFetch: vi.fn(),
  useGetStaffDirectory: () => ({ data: { currentUserId: 'staff-one', members: [] }, isError: false }),
  useUpdateEnquiryWorkspace: () => ({ mutateAsync: workspaceMutation, isPending: false, isError: false }),
  useChangeStaffFollowUp: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }),
}));

function entry(id: string, extra: Partial<Enquiry> = {}) {
  return {
    id, reference: `CALL-${id}`, customerName: `Customer ${id}`, phone: '07700900123', email: `${id}@example.test`,
    status: 'new', type: 'general', vehicleTitle: 'Ford Focus', vehicleId: null, appointmentAt: null,
    assignedToId: 'staff-one', assignedToName: 'Sam Dealer', message: 'Please confirm the service history.',
    workspaceRevision: 1, followUpRevision: 1, ...extra,
  } as Enquiry;
}
function show(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}
const conversationCalls = () => vi.mocked(customFetch).mock.calls.filter(([url]) => String(url).endsWith('/conversations'));
beforeEach(() => {
  workspaceMutation.mockReset().mockResolvedValue({});
  vi.mocked(customFetch).mockReset().mockImplementation(async url => (url === '/api/staff/phone-sharing-settings'
    ? { revision: 0, enabled: true }
    : { events: [], total: 0, nextCursor: null }) as never);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

it('keeps every waiting customer reachable while limiting the initial Today list', () => {
  const entries = Array.from({ length: 8 }, (_, index) => entry(String(index)));
  const open = vi.fn();
  show(<TodayDesk entries={entries} onOpen={open} />);
  const group = screen.getByRole('region', { name: 'Waiting for a reply' });
  expect(within(group).getAllByRole('listitem')).toHaveLength(5);
  expect(within(group).queryByText('Customer 7')).not.toBeInTheDocument();
  fireEvent.click(within(group).getByRole('button', { name: 'Show all 8' }));
  expect(within(group).getAllByRole('listitem')).toHaveLength(8);
  fireEvent.click(within(group).getByRole('button', { name: 'Open enquiry for Customer 7, Ford Focus' }));
  expect(open).toHaveBeenCalledWith(entries[7]);
  expect(group).not.toHaveTextContent('CALL-7');
  expect(within(group).getByRole('button', { name: 'Open enquiry for Customer 7, Ford Focus' })).not.toHaveAttribute('aria-label', expect.stringContaining('CALL-'));
  fireEvent.click(within(group).getByRole('button', { name: 'Show fewer' }));
  expect(within(group).getAllByRole('listitem')).toHaveLength(5);
});

it('passes the selected original record to the email action and keeps occasional actions available', () => {
  const first = entry('first'), selected = entry('selected');
  const email = vi.fn(), update = vi.fn();
  const actions: EnquiryRecordActions = { onEmail: email, onUpdate: update, onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook: vi.fn(), onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[first, selected]} cars={[]} selectedId={selected.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  const detail = screen.getByRole('region', { name: 'Selected enquiry: Customer selected' });
  expect(detail).not.toHaveTextContent('CALL-selected');
  fireEvent.click(within(detail).getByRole('button', { name: 'Reply' }));
  expect(email).toHaveBeenCalledWith(selected);
  const more = within(detail).getByText('Customer details & more', { exact: true }).closest('details')!;
  expect(more).not.toHaveAttribute('open');
  fireEvent.click(within(detail).getByText('Customer details & more', { exact: true }));
  fireEvent.click(within(detail).getByRole('button', { name: 'Update enquiry' }));
  expect(update).toHaveBeenCalledWith(selected);
  expect(within(detail).getByRole('link', { name: 'Start sale' })).toHaveAttribute('href', '/portal?section=sales&enquiryId=selected');
  expect(conversationCalls()).toEqual([['/api/staff/enquiries/selected/conversations', expect.objectContaining({ responseType: 'json' })]]);
  expect(vi.mocked(customFetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it('does not hide stock errors or pending booking approvals inside optional reporting', async () => {
  vi.mocked(customFetch).mockImplementation(async url => url === '/api/staff/phone-sharing-settings'
    ? { revision: 0, enabled: true } as never
    : url === '/api/staff/access'
    ? { role: 'owner', permissions: [], user: { name: 'Sam Dealer' } }
    : {
      generatedAt: new Date().toISOString(), unansweredEnquiries: 2, upcomingAppointments: 1, pendingAppointments: 1,
      overdueFollowUps: 0, outstandingBalancePence: 0, salesWithBalance: 0, upcomingDeliveries: 0,
      stockCount: 8, completedSales: 2, totalEnquiries: 10, convertedEnquiries: 3, enquiryConversionPercent: 30,
      completedConversionPercent: 20, appointments: [], balances: [], deliveries: [],
      stock: { stale: true, lastSuccessfulSync: null, alerts: [{ code: 'auth_failure', severity: 'error', message: 'Stock credential rejected. Check the connection.' }] },
    } as never);
  show(<DealerDashboard />);
  expect(await screen.findByText('Stock credential rejected. Check the connection.')).toBeVisible();
  expect(screen.getByRole('link', { name: /1 booking needs approval/ })).toBeVisible();
  expect(screen.getByRole('link', { name: /Cars in stock\s*8/ })).toHaveAttribute('href', '/portal?section=inventory');
  expect(screen.getByText('More dealership details').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('link', { name: /Outstanding balance\s*£0\.00/ })).toBeVisible();
});


it.each(['sold', 'archived'] as const)('shows the known %s state when staff view a linked car', status => {
  const selected = entry('selected', { vehicleId: 'car-one' });
  const actions: EnquiryRecordActions = { onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook: vi.fn(), onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[selected]} cars={[{ id: 'car-one', inventoryStatus: status } as unknown as Car]} selectedId={selected.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  const vehicle = screen.getByRole('region', { name: 'Selected enquiry: Customer selected' }).querySelector('[aria-label="Enquiry vehicle"]')!;
  expect(vehicle).toHaveTextContent(status === 'sold' ? 'Sold' : 'Archived');
  expect(vehicle).not.toHaveTextContent('Availability unconfirmed');
});


it('allows a new test drive after cancellation while retaining the original appointment history', () => {
  const cancelled = entry('cancelled', { appointmentAt: '2026-10-10T11:00:00Z', appointmentCancelledAt: '2026-10-09T10:00:00Z' });
  const onBook = vi.fn();
  const actions: EnquiryRecordActions = { onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook, onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[cancelled]} cars={[]} selectedId={cancelled.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  expect(within(screen.getByRole('region', { name: 'Selected enquiry: Customer cancelled' })).getByText('Visit cancelled', { exact: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Change appointment' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Book another test drive' }));
  expect(onBook).toHaveBeenCalledWith(cancelled);
});

it.each([
  ['past', { appointmentAt: '2020-10-10T11:00:00Z', attendance: 'scheduled' }],
  ['completed', { appointmentAt: '2099-10-10T11:00:00Z', attendance: 'completed' }],
  ['no-show', { appointmentAt: '2020-10-10T11:00:00Z', attendance: 'no_show' }],
] as const)('can arrange another visit after a %s appointment without editing the original', (_kind, appointment) => {
  const previous = entry('previous', { appointmentStatus: 'confirmed', ...appointment });
  const onBook = vi.fn(), onAppointment = vi.fn();
  const actions: EnquiryRecordActions = { onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment, onBook, onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[previous]} cars={[]} selectedId={previous.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  expect(screen.queryByRole('button', { name: 'Change appointment' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Book another test drive' }));
  expect(onBook).toHaveBeenCalledExactlyOnceWith(previous);
  expect(onAppointment).not.toHaveBeenCalled();
  expect(previous.appointmentAt).toBe(appointment.appointmentAt);
});

it('keeps changing an existing future appointment separate from creating a second visit', () => {
  const upcoming = entry('upcoming', { appointmentStatus: 'confirmed', appointmentAt: '2099-10-10T11:00:00Z', attendance: 'scheduled' });
  const onBook = vi.fn(), onAppointment = vi.fn();
  const actions: EnquiryRecordActions = { onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment, onBook, onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[upcoming]} cars={[]} selectedId={upcoming.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  expect(screen.queryByRole('button', { name: 'Book another test drive' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Change appointment' }));
  expect(onAppointment).toHaveBeenCalledExactlyOnceWith(upcoming);
  expect(onBook).not.toHaveBeenCalled();
});

it('loads each merged original conversation only when that original is expanded', async () => {
  const main = entry('main', { createdAt: '2026-10-17T09:00:00Z' });
  const original = entry('original', { mergedIntoId: 'main', createdAt: '2026-10-16T09:00:00Z' });
  const actions: EnquiryRecordActions = { onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook: vi.fn(), onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[main]} allEntries={[main, original]} cars={[]} selectedId="main" onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  await waitFor(() => expect(conversationCalls()).toHaveLength(1));
  expect(conversationCalls()[0][0]).toBe('/api/staff/enquiries/main/conversations');
  const originals = screen.getByRole('region', { name: 'Merged case original records' });
  const details = originals.querySelector('details')!;
  expect(details).not.toHaveAttribute('open');
  details.open = true;
  fireEvent(details, new Event('toggle'));
  await waitFor(() => expect(conversationCalls()).toHaveLength(2));
  expect(conversationCalls()[1][0]).toBe('/api/staff/enquiries/original/conversations');
  expect(within(originals).getByText('Customer original')).toBeVisible();
});


it('visibly disables booking while keeping conversation and appointment management accessible', () => {
  const selected = entry('paused');
  const onBook = vi.fn(), onConversation = vi.fn();
  const actions: EnquiryRecordActions = { canBook: false, onUpdate: vi.fn(), onConversation, onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook, onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[selected]} cars={[]} selectedId={selected.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  expect(screen.getByRole('button', { name: 'Book test drive' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Book test drive' }));
  expect(onBook).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Record the response' }));
  expect(onConversation).toHaveBeenCalledWith(selected);
});

it('keeps an existing appointment accessible for cancellation while new bookings are paused', () => {
  const selected = entry('paused-booking', { appointmentAt: '2099-11-02T11:00:00Z', appointmentStatus: 'confirmed', attendance: 'scheduled' });
  const onAppointment = vi.fn();
  const actions: EnquiryRecordActions = { canBook: false, onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment, onBook: vi.fn(), onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[selected]} cars={[]} selectedId={selected.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  expect(screen.getByRole('button', { name: 'Change appointment' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Change appointment' }));
  expect(onAppointment).toHaveBeenCalledWith(selected);
});

it('surfaces an overdue merged original even when the main enquiry is closed, and opens that task on demand', async () => {
  const main = entry('closed-main', { status: 'closed', callOutcome: 'information_given', createdAt: '2026-10-17T09:00:00Z' });
  const original = entry('overdue-original', {
    mergedIntoId: main.id, createdAt: '2026-10-16T09:00:00Z', vehicleTitle: 'Toyota Yaris',
    followUpAt: '2020-10-16T10:00:00Z', followUpNote: 'Call about the Toyota service history.',
  });
  const onFollowUp = vi.fn();
  const actions: EnquiryRecordActions = { onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp, onAppointment: vi.fn(), onBook: vi.fn(), onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[main]} allEntries={[main, original]} cars={[]} selectedId={main.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);

  const row = screen.getByRole('button', { name: 'Open enquiry for Customer closed-main, Ford Focus' });
  expect(within(row).getByText('Follow-up overdue', { exact: true })).toBeVisible();
  expect(within(row).getByText('Complete follow-up', { exact: true })).toBeVisible();
  expect(within(row).queryByText('No further action', { exact: true })).not.toBeInTheDocument();
  expect(within(row).getByText('Next step is on a linked enquiry')).toBeVisible();

  const linkedWork = screen.getByRole('region', { name: 'Work on linked enquiries' });
  expect(within(linkedWork).getByText('Follow-up overdue', { exact: true })).toBeVisible();
  expect(within(linkedWork).getByText('Customer overdue-original — Toyota Yaris')).toBeVisible();
  const originals = screen.getByRole('region', { name: 'Merged case original records' });
  const details = originals.querySelector('details')!;
  details.scrollIntoView = vi.fn();
  expect(details).not.toHaveAttribute('open');
  expect(within(originals).queryByRole('region', { name: 'Recommended next action' })).not.toBeInTheDocument();
  await waitFor(() => expect(conversationCalls()).toEqual([['/api/staff/enquiries/closed-main/conversations', expect.anything()]]));

  fireEvent.click(within(linkedWork).getByRole('button', { name: 'Open linked task' }));
  expect(details).toHaveAttribute('open');
  const task = within(originals).getByRole('region', { name: 'Recommended next action' });
  expect(within(task).getByText('Call about the Toyota service history.')).toBeVisible();
  await waitFor(() => expect(customFetch).toHaveBeenCalledWith('/api/staff/enquiries/overdue-original/conversations', expect.anything()));
  fireEvent.click(within(task).getByRole('button', { name: 'Complete follow-up' }));
  expect(onFollowUp).toHaveBeenCalledExactlyOnceWith(original);
  expect(workspaceMutation).not.toHaveBeenCalled();
});

it.each([
  ['scheduled', 'Mark arrived', 'arrived'],
  ['arrived', 'Complete visit', 'completed'],
] as const)('offers the real attendance action for a %s visit in the recommended next step', async (attendance, label, nextAttendance) => {
  const visit = entry('visit', { appointmentAt: '2020-10-20T09:00:00Z', appointmentStatus: 'confirmed', appointmentRevision: 3, attendance });
  const onUpdate = vi.fn();
  const actions: EnquiryRecordActions = { onUpdate, onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook: vi.fn(), onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[visit]} cars={[]} selectedId={visit.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  const nextStep = screen.getByRole('region', { name: 'Recommended next action' });
  const attendanceButton = within(nextStep).getByRole('button', { name: label });
  expect(attendanceButton).toBeEnabled();
  expect(within(nextStep).queryByRole('button', { name: 'Update enquiry' })).not.toBeInTheDocument();
  expect(within(nextStep).queryByRole('button', { name: 'Update the visit' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: label })).toHaveLength(1);
  fireEvent.click(attendanceButton);
  await waitFor(() => expect(workspaceMutation).toHaveBeenCalledExactlyOnceWith({ id: visit.id, data: { expectedRevision: 1, expectedAppointmentRevision: 3, attendance: nextAttendance } }));
  expect(onUpdate).not.toHaveBeenCalled();
});

it('explains missing contact details without offering an unrelated owner-and-notes edit as the primary action', () => {
  const contactMissing = entry('contact-missing', { phone: null, email: null });
  const onUpdate = vi.fn();
  const actions: EnquiryRecordActions = { onUpdate, onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook: vi.fn(), onVehicle: vi.fn() };
  show(<EnquiryRecordBrowser entries={[contactMissing]} cars={[]} selectedId={contactMissing.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
  const nextStep = screen.getByRole('region', { name: 'Recommended next action' });
  expect(within(nextStep).getByRole('heading', { name: 'Check contact details' })).toBeVisible();
  expect(within(nextStep).getByText('No phone number or email address is recorded.')).toBeVisible();
  expect(within(nextStep).queryByRole('button')).not.toBeInTheDocument();
  expect(onUpdate).not.toHaveBeenCalled();
});

it('prepares a follow-up for the selected missed appointment without sending or opening a generic reply', () => {
 const selected = entry('missed-appointment', { appointmentAt: '2020-10-10T11:00:00Z', attendance: 'no_show' });
 const followUpEmail = vi.fn(), email = vi.fn();
 const actions: EnquiryRecordActions = { onEmail: email, onAppointmentFollowUp: followUpEmail, onUpdate: vi.fn(), onConversation: vi.fn(), onFollowUp: vi.fn(), onAppointment: vi.fn(), onBook: vi.fn(), onVehicle: vi.fn() };
 show(<EnquiryRecordBrowser entries={[selected]} cars={[]} selectedId={selected.id} onSelect={vi.fn()} onBack={vi.fn()} actions={actions} />);
 fireEvent.click(screen.getByRole('button', { name: 'Follow-up email' }));
 expect(followUpEmail).toHaveBeenCalledExactlyOnceWith(selected);
 expect(email).not.toHaveBeenCalled();
 expect(vi.mocked(customFetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});
