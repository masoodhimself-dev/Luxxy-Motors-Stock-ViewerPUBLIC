import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';

const state = vi.hoisted(() => ({
  success: false,
  enquiry: { reference: 'INTERNAL-ENQUIRY-123', appointmentAt: '2026-10-20T14:00:00Z', appointmentStatus: 'confirmed', appointmentDurationMinutes: 30, customerNotificationStatus: 'sent', calendarIcs: 'BEGIN:VCALENDAR\nEND:VCALENDAR', managePath: '/viewing/private-booking-link' },
  mutate: vi.fn(), reset: vi.fn(),
}));
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...await importOriginal<object>(),
  customFetch: vi.fn(async () => ({ enabled: false })),
  useCreateEnquiry: () => ({ data: state.success ? state.enquiry : undefined, isSuccess: state.success, isPending: false, isError: false, mutate: state.mutate, reset: state.reset }),
  useGetEnquiryAvailability: () => ({ data: { slots: [] }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
}));
vi.mock('@/lib/dealer-settings-context', async () => {
  const { dealerConfig } = await import('@/config/dealer');
  const { defaultBookingSettings } = await import('@/lib/test-drive-dates');
  const settings = { ...dealerConfig, contact: { phone: '07700900123', whatsapp: '447700900123' }, hours: [], testDriveBooking: defaultBookingSettings };
  return { useDealerSettings: () => ({ settings, isLoading: false, isError: false }) };
});
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => true, isLoading: false, isError: false }) }));
import { EnquiryForm } from './enquiry-form';
import { TestDriveBooking } from './test-drive-booking';
import { VehicleCall } from './vehicle-call';

const car = { id: 'internal-vehicle', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta', year: 2020, price: 6500, plate: 'AB20 CDE', images: [], inventoryStatus: 'available' } as unknown as Car;
function mount(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  state.success = false;
  window.history.replaceState({}, '', '/enquire');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});

it('confirms an enquiry using the customer and car without displaying an internal reference', () => {
  const view = mount(<EnquiryForm vehicle={car} stockCars={[car]} />);
  fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Alex Buyer' } });
  fireEvent.change(screen.getByTestId('input-customer-email'), { target: { value: 'alex@example.test' } });
  state.success = true;
  view.rerender(<QueryClientProvider client={new QueryClient()}><EnquiryForm vehicle={car} stockCars={[car]} /></QueryClientProvider>);
  expect(screen.getByTestId('status-enquiry-success')).toHaveTextContent('Thank you, Alex Buyer.');
  expect(screen.getByTestId('text-confirmed-vehicle')).toHaveTextContent('Ford Fiesta');
  expect(screen.getByText('We sent your enquiry details to alex@example.test.')).toBeInTheDocument();
  expect(screen.queryByText(/INTERNAL-ENQUIRY|Your reference/)).not.toBeInTheDocument();
  expect(state.mutate).not.toHaveBeenCalled();
});

it('keeps appointment and private management links while hiding the booking reference and filename', () => {
  state.success = true;
  mount(<TestDriveBooking vehicle={car} stockCars={[car]} />);
  expect(screen.getByRole('heading', { name: 'Your test drive is booked' })).toBeInTheDocument();
  expect(screen.getByText(/20 October/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Manage test drive' })).toHaveAttribute('href', '/viewing/private-booking-link');
  expect(screen.getByTestId('link-download-calendar')).toHaveAttribute('download', 'test-drive.ics');
  expect(screen.queryByText(/INTERNAL-ENQUIRY|Booking reference/)).not.toBeInTheDocument();
});

it('confirms the callback with the selected car and opening-hours guidance without its internal reference', () => {
  state.success = true;
  mount(<VehicleCall car={car} />);
  fireEvent.click(screen.getByRole('link', { name: 'Call about Ford Fiesta' }));
  fireEvent.click(screen.getByRole('button', { name: 'View callback request' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('We’ve received your callback request')).toBeVisible();
  expect(dialog).toHaveTextContent('during opening hours');
  expect(dialog).toHaveTextContent('Ford Fiesta');
  expect(dialog).not.toHaveTextContent('INTERNAL-ENQUIRY');
});
