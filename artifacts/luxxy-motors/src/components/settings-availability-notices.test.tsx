import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DealerTestDriveBooking } from '@workspace/api-client-react';
const state = vi.hoisted(() => ({ loading: false, error: false, fetching: false, availability: true as boolean | undefined, refetch: vi.fn() }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ isLoading: state.loading, isError: state.error, isFetching: state.fetching, data: state.availability === undefined ? undefined : { features: { testDriveBookings: state.availability } }, refetch: state.refetch }) }));
import { PlatformFeatureNotice, BookingHoursNotice, bookingHoursWarnings } from './settings-availability-notices';

const booking = (): DealerTestDriveBooking => ({ enabled: true, durationMinutes: 30, bufferMinutes: 0, minimumNoticeHours: 0, dailyCapacity: 4, daysAhead: 30, blockedDates: [], instructions: '', confirmationMode: 'approval', weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: day === 1, open: '10:00', close: '17:00' })) });
beforeEach(() => { state.loading = false; state.error = false; state.fetching = false; state.availability = true; state.refetch.mockReset(); });

it('shows confirmed feature unavailability without claiming its reason or changing settings', () => {
  state.availability = false;
  render(<PlatformFeatureNotice feature="testDriveBookings" />);
  expect(screen.getByRole('status')).toHaveTextContent('Online test-drive booking is currently unavailable for this dealership.');
  expect(screen.getByRole('status')).toHaveTextContent('Changing or publishing settings here does not enable this feature.');
  expect(screen.queryByRole('button')).toBeNull();
  expect(state.refetch).not.toHaveBeenCalled();
});

it.each(['loading', 'error', 'missing'] as const)('does not call unknown availability paused while %s', status => {
  state.loading = status === 'loading'; state.error = status === 'error'; state.availability = undefined;
  render(<PlatformFeatureNotice feature="testDriveBookings" />);
  expect(screen.getByRole('status')).not.toHaveTextContent('is currently unavailable');
  if (status === 'loading') expect(screen.getByRole('status')).toHaveTextContent('Checking online test-drive booking availability');
  else {
    expect(screen.getByRole('status')).toHaveTextContent('availability could not be confirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry availability check' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  }
});

it('omits a warning when availability is confirmed and handles a stale response error as unknown', () => {
  const page = render(<PlatformFeatureNotice feature="testDriveBookings" />);
  expect(screen.queryByRole('status')).toBeNull();
  state.error = true;
  page.rerender(<PlatformFeatureNotice feature="testDriveBookings" />);
  expect(screen.getByRole('status')).toHaveTextContent('availability could not be confirmed');
});

it('warns about outside hours and explicit closure without changing either timetable', () => {
  const hours = [{ days: 'Monday', times: '11am - 4pm' }, { days: 'Sunday', times: 'Closed' }];
  const policy = booking(); policy.weeklyHours[0] = { day: 0, enabled: true, open: '10:00', close: '12:00' };
  const before = JSON.stringify({ hours, policy });
  render(<BookingHoursNotice hours={hours} booking={policy} />);
  expect(screen.getByRole('status')).toHaveTextContent('Monday: appointments are set for 10:00–17:00, outside the showroom hours of 11:00–16:00.');
  expect(screen.getByRole('status')).toHaveTextContent('Sunday: appointments are set for 10:00–12:00, while the showroom is shown as closed.');
  expect(screen.getByRole('status')).toHaveTextContent('nothing is changed automatically');
  expect(JSON.stringify({ hours, policy })).toBe(before);
});

it('does not mistake missing or custom showroom information for closure', () => {
  expect(bookingHoursWarnings([], booking())).toEqual([expect.stringContaining('showroom opening hours are unconfirmed')]);
  const custom = bookingHoursWarnings([{ days: 'Monday', times: 'By appointment only' }], booking());
  expect(custom).toEqual([expect.stringContaining('cannot be compared automatically')]);
  expect(custom.join(' ')).not.toContain('shown as closed');
});

it('keeps shorter appointment hours, disabled booking and incomplete edit fields quiet', () => {
  expect(bookingHoursWarnings([{ days: 'Monday', times: '09:00 - 18:00' }], booking())).toEqual([]);
  const disabled = booking(); disabled.enabled = false;
  expect(bookingHoursWarnings([], disabled)).toEqual([]);
  const incomplete = booking(); incomplete.weeklyHours[1].close = '';
  expect(bookingHoursWarnings([], incomplete)).toEqual([]);
  render(<BookingHoursNotice hours={[]} booking={disabled} />);
  expect(screen.queryByRole('status')).toBeNull();
});
