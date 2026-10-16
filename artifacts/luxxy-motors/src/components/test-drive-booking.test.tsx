import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { defaultBookingSettings } from '@/lib/test-drive-dates';
import { TestDriveBooking } from './test-drive-booking';

const state = vi.hoisted(() => ({ failed: false, mutate: vi.fn(), reset: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({
  useCreateEnquiry: () => ({ isPending: false, isSuccess: false, isError: false, mutate: state.mutate, reset: state.reset }),
  getGetEnquiryAvailabilityQueryKey: (params: unknown) => [params],
  useGetEnquiryAvailability: ({ date }: { date: string }) => ({
    isLoading: false, isFetching: false, isError: state.failed,
    data: { slots: [{ available: true, label: '10:00 am', startAt: `${date}T09:00:00.000Z` }] },
    refetch: vi.fn(),
  }),
}));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({
  settings: {
    identity: { name: 'Test Motors' }, address: {}, contact: {}, hours: [],
    testDriveBooking: { ...defaultBookingSettings, daysAhead: 3, weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, open: '09:00', close: '18:00' })) },
  },
  isLoading: false, isError: false,
}) }));

const car = { id: 'booking-car', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta', price: 6500, year: 2020, images: [], inventoryStatus: 'available' } as unknown as Car;
const booking = () => <TestDriveBooking vehicle={car} stockCars={[car]} />;
beforeEach(() => {
  state.failed = false;
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
