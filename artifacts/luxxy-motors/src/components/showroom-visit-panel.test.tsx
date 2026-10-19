import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
const state = vi.hoisted(() => ({
  hours: [] as { days: string; times: string }[],
  address: {} as { street?: string; city?: string; postcode?: string; mapsUrl?: string },
  presentation: {} as { visitInstructions?: string; parkingInstructions?: string },
  loading: false, error: false, booking: true, dealerBooking: true,
}));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({
  settings: { ...dealerConfig, identity: { name: 'Test Motors' }, contact: { phone: '07388831790' }, address: state.address, hours: state.hours, presentation: state.presentation, testDriveBooking: { enabled: state.dealerBooking } },
  isLoading: state.loading, isError: state.error,
}) }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => state.booking }) }));
import { ShowroomVisitPanel } from './showroom-visit-panel';
import { VehicleVisit } from './vehicle-buying-guide';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date('2026-10-19T09:00:00Z'));
  state.hours = [{ days: 'Monday – Saturday', times: '08:00 – 18:00' }, { days: 'Sunday', times: 'Closed' }];
  state.address = { street: 'Rear of 176 Rayners Lane', city: 'London', postcode: 'HA2 8LY' };
  state.presentation = {}; state.loading = false; state.error = false; state.booking = true; state.dealerBooking = true;
});
afterEach(() => vi.useRealTimers());

it('puts configured showroom details, today’s closing time and working directions together', () => {
  render(<ShowroomVisitPanel />);
  expect(screen.getByRole('heading', { name: 'Plan your visit' })).toBeVisible();
  expect(screen.getByTestId('showroom-visit-panel')).toHaveTextContent('Test Motors');
  expect(screen.getByRole('status')).toHaveTextContent('Open now');
  expect(screen.getByRole('status')).toHaveTextContent('Closes at 18:00 today');
  expect(screen.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', expect.stringContaining('Rear%20of%20176%20Rayners%20Lane'));
  expect(screen.getByRole('link', { name: /Call Us/ })).toHaveAttribute('href', 'tel:07388831790');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByText('View all opening hours')).toBeVisible();
  fireEvent.click(screen.getByText('View all opening hours'));
  expect(screen.getByText('Sunday')).toBeVisible();
});
it('shows Sunday closed and the next confirmed opening in UK time', () => {
  vi.setSystemTime(new Date('2026-10-18T13:00:00Z'));
  render(<ShowroomVisitPanel />);
  expect(screen.getByRole('status')).toHaveTextContent('Closed today');
  expect(screen.getByRole('status')).toHaveTextContent('Opens tomorrow at 08:00 (UK time)');
});
it('uses the winter clock without interpreting the visitor’s timezone as showroom time', () => {
  vi.setSystemTime(new Date('2026-12-28T07:30:00Z'));
  render(<ShowroomVisitPanel />);
  expect(screen.getByRole('status')).toHaveTextContent('Closed now');
  expect(screen.getByRole('status')).toHaveTextContent('Opens today at 08:00 (UK time)');
});
it('refreshes an open page when the showroom closes', () => {
  vi.setSystemTime(new Date('2026-10-19T16:59:50Z'));
  render(<ShowroomVisitPanel />);
  expect(screen.getByRole('status')).toHaveTextContent('Closing soon');
  act(() => vi.advanceTimersByTime(30_000));
  expect(screen.getByRole('status')).toHaveTextContent('Closed now');
  expect(screen.getByRole('status')).toHaveTextContent('Closed at 18:00 today');
});
it('does not treat an unknown day as closed or invent arrival information', () => {
  state.hours = [{ days: 'Monday – Saturday', times: '08:00 – 18:00' }];
  vi.setSystemTime(new Date('2026-10-18T13:00:00Z'));
  render(<ShowroomVisitPanel />);
  expect(screen.getByRole('status')).toHaveTextContent('Hours to confirm');
  expect(screen.getByRole('status')).not.toHaveTextContent('Closed today');
  expect(screen.queryByRole('heading', { name: 'When you arrive' })).not.toBeInTheDocument();
});
it.each(['loading', 'error'] as const)('keeps fallback details out of the panel while settings are %s', kind => {
  state[kind] = true;
  render(<ShowroomVisitPanel />);
  expect(screen.getByTestId('showroom-visit-panel')).not.toHaveTextContent('Rear of 176');
  expect(screen.getByRole('status')).not.toHaveTextContent('Open now');
  expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Call Us/ })).not.toBeInTheDocument();
});
it('omits sample locations and unsafe maps links while keeping published arrival instructions', () => {
  state.address = { street: 'Sample Street', mapsUrl: 'javascript:alert(1)' };
  state.presentation = { visitInstructions: 'Entrance at the rear.', parkingInstructions: 'Please call at the gate.' };
  render(<ShowroomVisitPanel />);
  expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
  expect(screen.getByTestId('showroom-visit-panel')).not.toHaveTextContent('Sample Street');
  expect(screen.getByRole('heading', { name: 'When you arrive' })).toBeVisible();
  expect(screen.getByText('Entrance at the rear.')).toBeVisible();
  expect(screen.getByText('Please call at the gate.')).toBeVisible();
});
it('respects disabled bookings and a vehicle-specific action can be supplied separately', () => {
  state.booking = false;
  const view = render(<ShowroomVisitPanel />);
  expect(screen.queryByRole('link', { name: /Book a Test Drive/ })).not.toBeInTheDocument();
  state.booking = true;
  view.rerender(<ShowroomVisitPanel bookingHref="/enquire?type=viewing&vehicleId=car-1" />);
  expect(screen.getByRole('link', { name: /Book a Test Drive/ })).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=car-1');
  view.rerender(<ShowroomVisitPanel showBooking={false} heading={null} />);
  expect(screen.queryByRole('link', { name: /Book a Test Drive/ })).not.toBeInTheDocument();
  expect(within(screen.getByTestId('showroom-visit-panel')).queryByRole('heading', { name: 'Plan your visit' })).not.toBeInTheDocument();
});

it('keeps template arrival and parking placeholders off the public visit panel', () => {
  state.presentation = { visitInstructions: 'Sample visiting information: viewings by appointment.', parkingInstructions: 'Sample arrival instructions: customer spaces beside the entrance. Replace this with your arrangements.' };
  render(<ShowroomVisitPanel />);
  expect(screen.queryByRole('heading', { name: 'When you arrive' })).not.toBeInTheDocument();
  expect(screen.getByTestId('showroom-visit-panel')).not.toHaveTextContent('customer spaces');
});

it('shows a known area without treating a city-only address as a confirmed showroom', () => {
  state.address = { city: 'London', mapsUrl: 'https://maps.google.com/?q=London' };
  render(<ShowroomVisitPanel />);
  expect(screen.getByText('Showroom area: London')).toBeVisible();
  expect(screen.getByText('Contact us to confirm the showroom address before travelling.')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
});
it.each([
  { inventoryStatus: 'available', feature: true, dealer: true, visible: true },
  { inventoryStatus: 'reserved', feature: true, dealer: true, visible: false },
  { inventoryStatus: 'sold', feature: true, dealer: true, visible: false },
  { inventoryStatus: 'available', feature: false, dealer: true, visible: false },
  { inventoryStatus: 'available', feature: true, dealer: false, visible: false },
])('gates the car-specific visit booking for $inventoryStatus, feature=$feature, dealer=$dealer', ({ inventoryStatus, feature, dealer, visible }) => {
  state.booking = feature; state.dealerBooking = dealer;
  const car = { id: 'test-car', make: 'MG', model: 'HS', title: 'MG HS', inventoryStatus } as unknown as Car;
  render(<VehicleVisit car={car} />);
  const booking = screen.queryByRole('link', { name: 'Choose a test-drive time' });
  if (visible) expect(booking).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=test-car');
  else expect(booking).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Get directions' })).toHaveLength(1);
});
