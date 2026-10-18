import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ViewingBooking } from '@workspace/api-client-react';
import { defaultBookingSettings } from '@/lib/test-drive-dates';

const state = vi.hoisted(() => ({
  booking: null as ViewingBooking | null,
  queryError: null as { status: number } | null,
  availabilityEmpty: false,
  availabilityFetching: false,
  availabilityFailed: false,
  cancelPending: false,
  cancelError: null as { data: { error: string } } | null,
  reschedulePending: false,
  rescheduleSuccess: false,
  rescheduleError: null as { data: { error: string } } | null,
  cancel: vi.fn(), reschedule: vi.fn(), cancelReset: vi.fn(), rescheduleReset: vi.fn(),
  refetchBooking: vi.fn(), refetchAvailability: vi.fn(), setQueryData: vi.fn(), invalidateQueries: vi.fn(),
}));

vi.mock('@tanstack/react-query', async importOriginal => ({
  ...await importOriginal<object>(),
  useQueryClient: () => ({ setQueryData: state.setQueryData, invalidateQueries: state.invalidateQueries }),
}));
vi.mock('wouter', async importOriginal => ({ ...await importOriginal<object>(), useParams: () => ({ token: 'private-booking-token' }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetEnquiryAvailabilityQueryKey: ({ date }: { date: string }) => ['availability', date],
  getGetViewingBookingQueryKey: (token: string) => ['booking', token],
  useGetViewingBooking: () => ({ data: state.booking, isLoading: false, isFetching: false, isError: Boolean(state.queryError), error: state.queryError, refetch: state.refetchBooking }),
  useGetEnquiryAvailability: ({ date }: { date: string }) => ({
    isLoading: false, isFetching: state.availabilityFetching, isError: state.availabilityFailed,
    data: { slots: [
      { startAt: `${date}T09:00:00.000Z`, label: '10:00 am', available: !state.availabilityEmpty },
      { startAt: `${date}T10:00:00.000Z`, label: '11:00 am', available: false },
    ] },
    refetch: state.refetchAvailability,
  }),
  useCancelViewing: () => ({ mutate: state.cancel, reset: state.cancelReset, isPending: state.cancelPending, isSuccess: false, isError: Boolean(state.cancelError), error: state.cancelError }),
  useRescheduleViewing: () => ({ mutate: state.reschedule, reset: state.rescheduleReset, isPending: state.reschedulePending, isSuccess: state.rescheduleSuccess, isError: Boolean(state.rescheduleError), error: state.rescheduleError }),
}));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: [] } }) }));
let policy = structuredClone(defaultBookingSettings);
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({
  settings: { identity: { name: 'Test Motors' }, address: {}, contact: { phone: '07700900123' }, testDriveBooking: policy }, isLoading: false,
}) }));
import Viewing from './viewing';

function booking(overrides: Partial<ViewingBooking> = {}): ViewingBooking {
  return {
    reference: 'TD-FICTIONAL', status: 'booked', customerName: 'Fictional Customer',
    appointmentAt: '2026-10-20T14:00:00.000Z', cancelledAt: null, durationMinutes: 30,
    timezone: 'Europe/London', vehicleTitle: 'Ford Fiesta', vehicleUrl: null,
    calendarIcs: 'BEGIN:VCALENDAR\nEND:VCALENDAR', canChange: true, ...overrides,
  };
}
function mount() { return render(<Viewing />); }
function openReschedule() { fireEvent.click(screen.getByTestId('button-viewing-reschedule')); }
function chooseTime() { fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button', { name: '10:00 am' })); }

it('shows useful booking details without exposing its internal reference', () => {
  mount();
  expect(screen.getByText('Hello, Fictional Customer.')).toBeInTheDocument();
  expect(screen.getByText('Ford Fiesta')).toBeInTheDocument();
  expect(screen.getByText(/20 October/)).toBeInTheDocument();
  expect(screen.queryByText(/TD-FICTIONAL/)).not.toBeInTheDocument();
  expect(screen.getByTestId('link-viewing-calendar')).toHaveAttribute('download', 'test-drive.ics');
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-17T08:00:00.000Z'));
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/viewing/private-booking-token');
  state.booking = booking(); state.queryError = null;
  state.availabilityEmpty = false; state.availabilityFetching = false; state.availabilityFailed = false;
  state.cancelPending = false; state.cancelError = null;
  state.reschedulePending = false; state.rescheduleSuccess = false; state.rescheduleError = null;
  policy = structuredClone(defaultBookingSettings);
  policy.daysAhead = 3;
  policy.weeklyHours = Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, open: '09:00', close: '18:00' }));
  state.setQueryData.mockImplementation((_key: unknown, value: ViewingBooking) => { state.booking = value; });
});
afterEach(() => vi.useRealTimers());

it('keeps private booking links out of previews and sets private-page browser policies', () => {
  state.booking = null;
  state.queryError = { status: 404 };
  const view = mount();
  expect(screen.getByRole('heading', { name: 'Cannot find booking' })).toBeInTheDocument();
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute('content', window.location.origin);
  expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', window.location.origin);
  view.unmount();
  expect(document.querySelector('meta[name="robots"]')).not.toBeInTheDocument();
  expect(document.querySelector('meta[name="referrer"]')).not.toBeInTheDocument();
});

it('asks before cancelling, keeps the booking when declined and sends only explicit confirmation', () => {
  mount();
  fireEvent.click(screen.getByTestId('button-viewing-cancel'));
  expect(screen.getByRole('heading', { name: 'Cancel your test drive?' })).toBeInTheDocument();
  expect(state.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('button-abort-cancel'));
  expect(screen.queryByTestId('button-confirm-cancel')).not.toBeInTheDocument();
  expect(screen.getByTestId('button-viewing-reschedule')).toBeEnabled();
  expect(state.cancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('button-viewing-cancel'));
  fireEvent.click(screen.getByTestId('button-confirm-cancel'));
  expect(state.cancel).toHaveBeenCalledTimes(1);
  expect(state.cancel.mock.calls[0][0]).toEqual({ token: 'private-booking-token', data: {} });
  const updated = booking({ status: 'cancelled', cancelledAt: '2026-10-17T08:01:00.000Z', canChange: false });
  act(() => { state.cancel.mock.calls[0][1].onSuccess(updated); });
  expect(state.setQueryData).toHaveBeenCalledWith(['booking', 'private-booking-token'], updated);
  expect(screen.getByRole('heading', { name: 'Test drive cancelled' })).toBeInTheDocument();
  expect(screen.getByTestId('status-viewing-cancelled')).toHaveTextContent('This test drive will not go ahead');
  expect(screen.queryByTestId('button-viewing-reschedule')).not.toBeInTheDocument();
});

it('preserves the current appointment until a newly selected date and time are confirmed', () => {
  mount();
  openReschedule();
  expect(screen.getByText(/Your current time stays booked until you confirm a new one/)).toBeInTheDocument();
  expect(screen.getByTestId('button-confirm-reschedule')).toBeDisabled();
  fireEvent.click(screen.getByTestId('button-viewing-date-2026-10-19'));
  chooseTime();
  expect(state.reschedule).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('button-confirm-reschedule'));
  expect(state.reschedule).toHaveBeenCalledTimes(1);
  expect(state.reschedule.mock.calls[0][0]).toEqual({ token: 'private-booking-token', data: { appointmentAt: '2026-10-19T09:00:00.000Z' } });
  const updated = booking({ appointmentAt: '2026-10-19T09:00:00.000Z' });
  act(() => { state.rescheduleSuccess = true; state.reschedule.mock.calls[0][1].onSuccess(updated); });
  expect(state.setQueryData).toHaveBeenCalledWith(['booking', 'private-booking-token'], updated);
  expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['availability', '2026-10-19'] });
  expect(screen.getByTestId('status-reschedule-success')).toHaveTextContent('your new time is confirmed');
  expect(screen.queryByTestId('button-confirm-reschedule')).not.toBeInTheDocument();
});

it.each([
  ['2026-10-19T10:00:00.000Z', '2026-10-19'],
  ['2026-11-02T10:00:00.000Z', '2026-10-17'],
])('starts rescheduling %s on its current UK day when bookable, otherwise the first booking day', (appointmentAt, selectedDay) => {
  state.booking = booking({ appointmentAt });
  mount(); openReschedule();
  expect(screen.getByTestId(`button-viewing-date-${selectedDay}`)).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('button-confirm-reschedule')).toBeDisabled();
  expect(state.reschedule).not.toHaveBeenCalled();
});

it('keeps the original appointment and clears the rejected choice after a failed reschedule', () => {
  const view = mount();
  const original = state.booking;
  openReschedule(); chooseTime();
  fireEvent.click(screen.getByTestId('button-confirm-reschedule'));
  act(() => {
    state.rescheduleError = { data: { error: 'That appointment time was just taken.' } };
    state.reschedule.mock.calls[0][1].onError();
  });
  view.rerender(<Viewing />);
  expect(screen.getByTestId('status-reschedule-error')).toHaveTextContent('That appointment time was just taken');
  expect(screen.getByTestId('button-confirm-reschedule')).toBeDisabled();
  expect(state.refetchAvailability).toHaveBeenCalledTimes(1);
  expect(state.setQueryData).not.toHaveBeenCalled();
  expect(state.booking).toBe(original);
  fireEvent.click(screen.getByTestId('button-cancel-reschedule'));
  expect(screen.getByRole('status')).toHaveTextContent('Confirmed');
  expect(screen.getByText(/20 October 2026 at 15:00/)).toBeInTheDocument();
});

it('keeps a failed cancellation recoverable without presenting the booking as cancelled', () => {
  const view = mount();
  fireEvent.click(screen.getByTestId('button-viewing-cancel'));
  fireEvent.click(screen.getByTestId('button-confirm-cancel'));
  state.cancelError = { data: { error: 'Your request could not be completed. Please try again.' } };
  view.rerender(<Viewing />);
  expect(screen.getByTestId('status-cancel-error')).toHaveTextContent('Please try again');
  expect(screen.getByTestId('button-abort-cancel')).toBeEnabled();
  expect(screen.queryByTestId('status-viewing-cancelled')).not.toBeInTheDocument();
  expect(state.setQueryData).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('button-abort-cancel'));
  expect(screen.getByRole('status')).toHaveTextContent('Confirmed');
});

it('keeps pending requests clearly unconfirmed and does not offer a calendar invitation', () => {
  state.booking = booking({ status: 'pending' });
  policy.confirmationMode = 'approval';
  mount();
  expect(screen.getByRole('heading', { name: 'Your test-drive request' })).toBeInTheDocument();
  expect(screen.getByTestId('status-viewing-pending')).toHaveTextContent('when your requested time is confirmed');
  expect(screen.queryByTestId('link-viewing-calendar')).not.toBeInTheDocument();
  openReschedule();
  expect(screen.getByTestId('button-confirm-reschedule')).toHaveTextContent('Request new time');
  expect(screen.getByText(/We’ll check your new requested time and contact you to confirm/)).toBeInTheDocument();
});

it('does not send a reschedule for an unavailable slot or while a recheck is pending or failed', () => {
  const view = mount();
  openReschedule();
  const unavailable = within(screen.getByTestId('group-viewing-slots')).getByRole('button', { name: '11:00 am' });
  expect(unavailable).toBeDisabled();
  fireEvent.click(unavailable);
  expect(screen.getByTestId('button-confirm-reschedule')).toBeDisabled();
  chooseTime();
  expect(screen.getByTestId('button-confirm-reschedule')).toBeEnabled();
  state.availabilityFetching = true;
  view.rerender(<Viewing />);
  expect(screen.getByTestId('loading-availability')).toBeInTheDocument();
  expect(screen.getByTestId('button-confirm-reschedule')).toBeDisabled();
  fireEvent.click(screen.getByTestId('button-confirm-reschedule'));
  state.availabilityFetching = false;
  state.availabilityFailed = true;
  view.rerender(<Viewing />);
  expect(screen.getByTestId('status-availability-error')).toBeInTheDocument();
  expect(screen.getByTestId('button-confirm-reschedule')).toBeDisabled();
  fireEvent.click(screen.getByTestId('button-confirm-reschedule'));
  expect(state.reschedule).not.toHaveBeenCalled();
});

it('drops a selection when another customer takes it and keeps the original booking intact', () => {
  const view = mount();
  openReschedule(); chooseTime();
  state.availabilityEmpty = true;
  view.rerender(<Viewing />);
  expect(screen.getByTestId('status-availability-empty')).toHaveTextContent('Please choose another day');
  expect(screen.getByTestId('button-confirm-reschedule')).toBeDisabled();
  fireEvent.click(screen.getByTestId('button-confirm-reschedule'));
  expect(state.reschedule).not.toHaveBeenCalled();
  expect(state.booking?.appointmentAt).toBe('2026-10-20T14:00:00.000Z');
});
