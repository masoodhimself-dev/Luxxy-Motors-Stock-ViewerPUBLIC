import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const state = vi.hoisted(() => ({ mutation: null as any, bookings: [] as any[], enquiries: [] as any[] | undefined, enquiriesError: false, bookingEnabled: true, fetch: vi.fn(), permissions: ['sales.manage'] }));
vi.mock('./dealer-administration', () => ({ useStaffAccess: () => ({ data: { permissions: state.permissions }, isError: false, isLoading: false }) }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ data: {}, enabled: () => state.bookingEnabled }) }));
vi.mock('@workspace/api-client-react', () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  getGetTestDriveBookingsQueryKey: () => ['test-drive-bookings'],
  getGetEnquiriesQueryKey: () => ['enquiries'],
  useDecideTestDriveBooking: (options: any) => { state.mutation = options.mutation; return { isPending: false, isError: false, mutate: vi.fn(), reset: vi.fn() }; },
  useGetEnquiries: () => ({ data: state.enquiries, isError: state.enquiriesError, isLoading: !state.enquiries && !state.enquiriesError, refetch: vi.fn() }),
  useGetTestDriveBookings: () => ({ data: state.bookings, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('wouter', () => ({ Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
vi.mock('./enquiry-calendar', () => ({ AppointmentExceptionLabels: () => null }));
vi.mock('./enquiry-workspace-tools', () => ({ AttendanceControls: () => null }));
vi.mock('./history-links', () => ({ HistoryLinks: () => null }));
vi.mock('./enquiry-merge', () => ({ EnquiryMergeDialog: () => null }));
import { TestDriveBookingsPanel } from './test-drive-bookings-panel';
beforeEach(() => {
  state.permissions = ['sales.manage'];
  state.fetch.mockReset();
  state.fetch.mockResolvedValue({ declarations: [], currentAppointmentRevision: 0 });
  state.bookings = [
    { id: 'enquiry-one', customerName: 'Alex', reference: 'ENQ-001', appointmentAt: '2099-10-17T10:00:00Z', appointmentStatus: 'pending', vehicleTitle: 'Ford Focus' },
    { id: 'enquiry-other', customerName: 'Jordan', reference: 'ENQ-002', appointmentAt: '2099-10-18T10:00:00Z', appointmentStatus: 'confirmed', vehicleTitle: 'Vauxhall Corsa' },
  ];
  state.enquiries = state.bookings.map(row => ({ ...row, createdAt: '2026-10-16T10:00:00Z' }));
  state.enquiriesError = false;
  state.bookingEnabled = true;
});
function mount(props: { canEmail?: boolean; enquiryId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><TestDriveBookingsPanel {...props} /></QueryClientProvider>) };
}
it('links a booking to its customer and prepares email only with permission', () => {
  mount({ canEmail: true, enquiryId: 'enquiry-one' });
  expect(screen.getByText('Alex')).toBeVisible();
  expect(screen.queryByText('Jordan')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open customer' })).toHaveAttribute('href', '/portal?section=notifications&workView=customers&enquiryId=enquiry-one');
  expect(screen.getByRole('link', { name: 'Prepare email' })).toHaveAttribute('href', '/portal?section=notifications&workView=email&compose=enquiry-one');
  expect(screen.getByRole('link', { name: 'Show all test drives' })).toHaveAttribute('href', '/portal?section=notifications&workView=test-drives');
});
it('keeps email actions hidden without permission', () => {
  mount({ enquiryId: 'enquiry-one' });
  expect(screen.queryByRole('link', { name: 'Prepare email' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open customer' })).toBeVisible();
});
it('prevents confirmations when platform booking controls are off while leaving decline and records available', () => {
  state.bookingEnabled = false;
  mount({ enquiryId: 'enquiry-one' });
  expect(screen.getByRole('button',{name:'Confirm appointment'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Decline'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Declaration & QR'})).toBeEnabled();
  expect(screen.getByText(/New test-drive bookings and confirmations are paused/)).toBeVisible();
});
it('never falls back to another customer when a contextual appointment is missing', () => {
  mount({ enquiryId: 'missing' });
  expect(screen.getByText('No matching appointment for this customer')).toBeVisible();
  expect(screen.queryByText('Jordan')).not.toBeInTheDocument();
  expect(screen.queryByText('Alex')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open customer' })).toHaveAttribute('href', '/portal?section=notifications&workView=customers&enquiryId=missing');
});
it('finds appointments on explicitly merged originals when opening the primary enquiry', () => {
  state.enquiries = [
    { id: 'primary', createdAt: '2026-10-16T09:00:00Z', customerName: 'Alex' },
    { ...state.bookings[0], createdAt: '2026-10-16T10:00:00Z', mergedIntoId: 'primary' },
    { ...state.bookings[1], createdAt: '2026-10-16T10:00:00Z' },
  ];
  mount({ enquiryId: 'primary' });
  expect(screen.getByText('Ford Focus')).toBeVisible();
  expect(screen.queryByText('Vauxhall Corsa')).not.toBeInTheDocument();
  expect(screen.getByText('Showing this enquiry and its merged records.')).toBeVisible();
});
it('waits for customer context before claiming there are no appointments', () => {
  state.enquiries = undefined;
  mount({ enquiryId: 'enquiry-one' });
  expect(screen.getByRole('status')).toHaveTextContent('Loading customer appointments');
  expect(screen.queryByText('No matching appointment for this customer')).not.toBeInTheDocument();
  expect(screen.queryByText('Jordan')).not.toBeInTheDocument();
});
it('shows a context-load error without revealing another customer’s appointments', () => {
  state.enquiries = undefined;
  state.enquiriesError = true;
  mount({ enquiryId: 'enquiry-one' });
  expect(screen.getByRole('alert')).toHaveTextContent('Customer records could not be loaded');
  expect(screen.getByRole('button', { name: 'Retry customer records' })).toBeVisible();
  expect(screen.queryByText('Jordan')).not.toBeInTheDocument();
});
it('refreshes the notifications, enquiry and booking views after a decision', async () => {
  const { client } = mount({ enquiryId: 'enquiry-one' });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  await state.mutation.onSuccess({}, { data: { decision: 'confirm' } });
  await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(3));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['test-drive-bookings'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['enquiries'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['staff-notifications'] });
});
it('checks only the next eight visible preparations and loads later bookings on request', async () => {
  state.bookings = Array.from({ length: 12 }, (_, index) => ({
    ...state.bookings[1], id: `booking-${index}`, customerName: `Customer ${index}`, vehicleId: 'car-one',
    appointmentAt: new Date(Date.UTC(2099, 9, 18, index)).toISOString(),
  }));
  mount();
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(8));
  expect(state.fetch.mock.calls.map(([url]) => url)).toEqual(Array.from({ length: 8 }, (_, index) => `/api/staff/enquiries/booking-${index}/test-drive-declarations`));
  const later = screen.getByTestId('staff-test-drive-booking-10');
  fireEvent.click(within(later).getByRole('button', { name: 'Check preparation' }));
  expect(await within(later).findByText('Declaration needed')).toBeVisible();
  expect(state.fetch).toHaveBeenCalledTimes(9);
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
it('keeps booking records readable for accounts without declaration controls or denied declaration requests', () => {
  state.permissions = ['sales.view', 'finance.export'];
  state.bookings = [{ ...state.bookings[1], vehicleId: 'car-one' }];
  mount();
  expect(screen.getByText('Jordan')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open customer' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Declaration & QR' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check preparation' })).not.toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});
