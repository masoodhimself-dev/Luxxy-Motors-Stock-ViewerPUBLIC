import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { defaultBookingSettings } from '@/lib/test-drive-dates';
import { TestDriveBooking } from './test-drive-booking';

const state = vi.hoisted(() => ({ failed: false, empty: false, fetching: false, mutate: vi.fn(), reset: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  useCreateEnquiry: () => ({ isPending: false, isSuccess: false, isError: false, mutate: state.mutate, reset: state.reset }),
  getGetEnquiryAvailabilityQueryKey: (params: unknown) => [params],
  useGetEnquiryAvailability: ({ date }: { date: string }) => ({
    isLoading: false, isFetching: state.fetching, isError: state.failed,
    data: { slots: state.empty ? [] : [{ available: true, label: '10:00 am', startAt: `${date}T09:00:00.000Z` }] },
    refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({
  settings: {
    identity: { name: 'Test Motors' }, address: {}, contact: { phone: '07700900123', whatsapp: '447700900123' }, hours: [],
    testDriveBooking: { ...defaultBookingSettings, daysAhead: 3, weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, open: '09:00', close: '18:00' })) },
  },
  isLoading: false, isError: false,
}) }));

const car = { id: 'booking-car', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta', price: 6500, year: 2020, images: [], inventoryStatus: 'available' } as unknown as Car;
const booking = () => <TestDriveBooking vehicle={car} stockCars={[car]} />;
beforeEach(() => {
  state.failed = false;
  state.empty = false;
  state.fetching = false;
  state.mutate.mockClear();
  window.sessionStorage.clear();
  window.history.replaceState({}, '', '/enquire?type=viewing&vehicleId=booking-car');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-16T08:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('formats quick dates in London even when the visitor is in a different timezone', () => {
  const original = Intl.DateTimeFormat;
  const dateFormat = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
    // Reproduce a visitor in UTC+14 without changing the test process timezone.
    return new original(locale, { timeZone: 'Pacific/Kiritimati', ...options });
  });
  render(booking());
  const tomorrow = screen.getByTestId('button-viewing-date-2026-10-17');
  expect(tomorrow).toHaveTextContent('17 Oct');
  expect(tomorrow).not.toHaveTextContent('18 Oct');
  const later = screen.getByTestId('button-viewing-date-2026-10-18');
  expect(later).toHaveTextContent('Sun');
  expect(later).toHaveTextContent('18 Oct');
  expect(dateFormat).toHaveBeenCalled();
});

it('refreshes available days when an open booking page crosses London midnight', () => {
  vi.setSystemTime(new Date('2026-10-16T22:59:30Z'));
  render(booking());
  expect(screen.getByTestId('button-viewing-date-2026-10-16')).toBeInTheDocument();
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(screen.queryByTestId('button-viewing-date-2026-10-16')).not.toBeInTheDocument();
  expect(screen.getByTestId('button-viewing-date-2026-10-17')).toHaveAttribute('aria-pressed', 'true');
});

it('does not continue with cached slots after an availability check fails', () => {
  const view = render(booking());
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  expect(screen.getByTestId('button-continue-to-details')).toBeEnabled();
  state.failed = true;
  view.rerender(booking());
  expect(screen.getByTestId('button-continue-to-details')).toBeDisabled();
  expect(screen.getByTestId('status-availability-error')).toBeInTheDocument();
});

it('keeps customer details and blocks confirmation when a recheck fails on review', () => {
  const view = render(booking());
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  fireEvent.click(screen.getByTestId('button-continue-to-details'));
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Fictional Customer' } });
  fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: '07700900123' } });
  fireEvent.change(screen.getByTestId('input-customer-email'), { target: { value: 'fictional@example.test' } });
  fireEvent.submit(screen.getByTestId('button-review-booking').closest('form')!);
  expect(screen.getByTestId('button-submit-enquiry')).toBeEnabled();
  state.failed = true;
  view.rerender(booking());
  expect(screen.getByTestId('button-submit-enquiry')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t recheck this time');
  expect(screen.getByTestId('booking-review')).toHaveTextContent('Fictional Customer');
  fireEvent.click(screen.getByTestId('button-submit-enquiry'));
  expect(state.mutate).not.toHaveBeenCalled();
});

it('stops on the details step when a selected slot disappears and offers a direct way to choose again', () => {
  const view = render(booking());
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  fireEvent.click(screen.getByTestId('button-continue-to-details'));
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Fictional Customer' } });
  fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: '07700900123' } });
  fireEvent.change(screen.getByTestId('input-customer-email'), { target: { value: 'fictional@example.test' } });
  state.empty = true;
  view.rerender(booking());
  expect(screen.getByTestId('button-review-booking')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('That time is no longer available');
  fireEvent.submit(screen.getByTestId('button-review-booking').closest('form')!);
  expect(screen.queryByTestId('booking-review')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Choose another time' }));
  expect(screen.getByRole('heading', { name: 'When would you like to come?' })).toBeInTheDocument();
  state.empty = false;
  view.rerender(booking());
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  fireEvent.click(screen.getByTestId('button-continue-to-details'));
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Fictional Customer');
  expect(screen.getByTestId('input-customer-phone')).toHaveValue('07700900123');
  expect(screen.getByTestId('input-customer-email')).toHaveValue('fictional@example.test');
  expect(state.mutate).not.toHaveBeenCalled();
});

it('explains a failed availability recheck before review and keeps the customer on their details', () => {
  const view = render(booking());
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  fireEvent.click(screen.getByTestId('button-continue-to-details'));
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Fictional Customer' } });
  state.failed = true;
  view.rerender(booking());
  expect(screen.getByTestId('button-review-booking')).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t recheck this time');
  fireEvent.submit(screen.getByTestId('button-review-booking').closest('form')!);
  expect(screen.queryByTestId('booking-review')).not.toBeInTheDocument();
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Fictional Customer');
  fireEvent.click(screen.getByRole('button', { name: 'Check available times' }));
  expect(screen.getByRole('heading', { name: 'When would you like to come?' })).toBeInTheDocument();
  expect(state.mutate).not.toHaveBeenCalled();
});

it('explains background rechecks on details and review and resumes once the check finishes', () => {
  const view = render(booking());
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  fireEvent.click(screen.getByTestId('button-continue-to-details'));
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Fictional Customer' } });
  fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: '07700900123' } });
  fireEvent.change(screen.getByTestId('input-customer-email'), { target: { value: 'fictional@example.test' } });
  state.fetching = true;
  view.rerender(booking());
  expect(screen.getByRole('status')).toHaveTextContent('Checking your selected time');
  expect(screen.getByTestId('button-review-booking')).toBeDisabled();
  fireEvent.submit(screen.getByTestId('button-review-booking').closest('form')!);
  expect(screen.queryByTestId('booking-review')).not.toBeInTheDocument();
  state.fetching = false;
  view.rerender(booking());
  fireEvent.submit(screen.getByTestId('button-review-booking').closest('form')!);
  expect(screen.getByTestId('booking-review')).toBeInTheDocument();
  state.fetching = true;
  view.rerender(booking());
  expect(screen.getByRole('status')).toHaveTextContent('Checking your selected time');
  expect(screen.getByTestId('button-submit-enquiry')).toBeDisabled();
  fireEvent.click(screen.getByTestId('button-submit-enquiry'));
  expect(state.mutate).not.toHaveBeenCalled();
  state.fetching = false;
  view.rerender(booking());
  expect(screen.queryByText('Checking your selected time…')).not.toBeInTheDocument();
  expect(screen.getByTestId('button-submit-enquiry')).toBeEnabled();
});

it('keeps the playful introduction on the first step and a compact car on later steps', () => {
  render(booking());
  expect(screen.getByLabelText('A little hello from your Ford Fiesta')).toBeInTheDocument();
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  fireEvent.click(screen.getByTestId('button-continue-to-details'));
  expect(screen.queryByLabelText('A little hello from your Ford Fiesta')).not.toBeInTheDocument();
  expect(screen.getByTestId('card-enquiry-vehicle')).toHaveClass('booking-car-compact');
  expect(screen.getByTestId('card-enquiry-vehicle')).toHaveTextContent('Ford Fiesta');
  fireEvent.click(screen.getByRole('button', { name: 'Change time' }));
  expect(screen.getByLabelText('A little hello from your Ford Fiesta')).toBeInTheDocument();
});

it('offers the next permitted date and direct contact when a day has no slots', () => {
  state.empty = true;
  render(booking());
  expect(screen.getByTestId('button-continue-to-details')).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Call Us' })).toHaveAttribute('href', 'tel:07700900123');
  expect(screen.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', expect.stringContaining('wa.me/447700900123'));
  fireEvent.click(screen.getByRole('button', { name: 'Check times on Saturday 17 October' }));
  expect(screen.getByTestId('button-viewing-date-2026-10-17')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId('button-continue-to-details')).toBeDisabled();
  expect(state.mutate).not.toHaveBeenCalled();
});

it('keeps the night-time message specific to an empty today, not future dates', () => {
  state.empty = true;
  vi.setSystemTime(new Date('2026-10-16T21:00:00Z'));
  render(booking());
  expect(screen.getByLabelText('Booking at night')).toHaveTextContent('Even car people need sleep');
  fireEvent.click(screen.getByTestId('button-viewing-date-2026-10-17'));
  expect(screen.queryByLabelText('Booking at night')).not.toBeInTheDocument();
  expect(screen.getByTestId('status-availability-empty')).toHaveTextContent('No appointments are available on this date');
});


it('adds part exchange once and keeps typed answers when removed and added again', () => {
  render(booking());
  fireEvent.click(within(screen.getByTestId('group-viewing-slots')).getByRole('button'));
  fireEvent.click(screen.getByTestId('button-continue-to-details'));
  fireEvent.click(screen.getByRole('button', { name: 'Add a part exchange (optional)' }));
  expect(screen.queryByRole('checkbox', { name: 'Yes, I have a car to part-exchange' })).not.toBeInTheDocument();
  const registration = screen.getByTestId('enquiry-part-exchange-plate-input');
  fireEvent.change(registration, { target: { value: 'AB12 CDE' } });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Approximate mileage' }), { target: { value: '42000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove part exchange' }));
  expect(screen.queryByTestId('enquiry-part-exchange-details')).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Fictional Buyer' } });
  fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: '07700900123' } });
  fireEvent.change(screen.getByTestId('input-customer-email'), { target: { value: 'fictional@example.test' } });
  fireEvent.submit(screen.getByTestId('button-review-booking').closest('form')!);
  expect(screen.getByTestId('booking-review')).not.toHaveTextContent('AB12 CDE');
  expect(state.mutate).not.toHaveBeenCalled();
  // The tab-local saved draft retains values, but flags them as excluded.
  const draft = JSON.parse(window.sessionStorage.getItem('luxxy.enquiry-draft.viewing:booking-car')!);
  expect(draft.data.hasPartExchange).toBe(false);
  expect(draft.data.exchange.registration).toBe('AB12 CDE');
  expect(draft.data.exchange.mileage).toBe('42000');
});
