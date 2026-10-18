import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Enquiry } from '@workspace/api-client-react';
import type { Car } from '@/lib/stock-context';
import { EnquiryCalendar } from './enquiry-calendar';
const state = vi.hoisted(() => ({ fetch: vi.fn(), permissions: ['sales.manage'] }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('./dealer-administration', () => ({ useStaffAccess: () => ({ data: { permissions: state.permissions }, isError: false, isLoading: false }) }));

function appointment(id: string, overrides: Partial<Enquiry> = {}): Enquiry {
  return { id, dealerId: 'fictional-dealer', reference: `ENQ-${id}`, customerName: `${id} Customer`, appointmentAt: '2026-10-17T12:00:00Z', appointmentStatus: 'confirmed', appointmentCancelledAt: null, appointmentDurationMinutes: 30, attendance: 'scheduled', vehicleId: 'car-one', vehicleTitle: 'Ford Focus', vehicleRegistration: 'AB12 CDE', assignedToName: 'Sam Staff', phone: '07700 900123', email: 'customer@example.test', source: 'website', message: 'Please have the service history ready.', ...overrides } as Enquiry;
}
const current = appointment('Alex');
const pending = appointment('Jordan', { appointmentAt: '2026-10-17T13:00:00Z', appointmentStatus: 'pending', appointmentDoubleBooked: true });
const cancelled = appointment('Cancelled', { appointmentCancelledAt: '2026-10-16T10:00:00Z' });
const car = { id: 'car-one', heroImage: 'https://images.example.test/focus.jpg', images: [] } as unknown as Car;
let mobile = false;
let onOpen = vi.fn();
let onEdit = vi.fn();
let onVehicle = vi.fn();
let onAdd = vi.fn();
function mount(entries = [current, pending], extra: Partial<Parameters<typeof EnquiryCalendar>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<EnquiryCalendar entries={entries} cars={[car]} onOpen={onOpen} onEdit={onEdit} onVehicle={onVehicle} onAdd={onAdd} {...extra} />, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
beforeEach(() => {
  state.permissions = ['sales.manage'];
  state.fetch.mockReset();
  state.fetch.mockResolvedValue({ declarations: [], currentAppointmentRevision: 0 });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-17T08:00:00Z'));
  mobile = false;
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: mobile, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  onOpen = vi.fn(); onEdit = vi.fn(); onVehicle = vi.fn(); onAdd = vi.fn();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('opens the desktop week with informative cards and never changes a booking on selection', () => {
  mount();
  expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
  const card = screen.getByRole('button', { name: '13:00, Alex Customer, Ford Focus, Confirmed' });
  expect(within(card).getByText('AB12 CDE')).toBeVisible();
  expect(within(card).getByText('Sam Staff')).toBeVisible();
  expect(card.querySelector('img')).toHaveAttribute('src', car.heroImage!);
  fireEvent.click(card);
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Alex Customer' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Call 07700 900123' })).toHaveAttribute('href', 'tel:07700900123');
  expect(screen.getByText('Please have the service history ready.')).toBeVisible();
  expect(onOpen).not.toHaveBeenCalled(); expect(onEdit).not.toHaveBeenCalled();
});
it('opens the phone on one day with a simple date strip', () => {
  mobile = true;
  mount();
  expect(screen.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('navigation', { name: 'Choose appointment day' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Sunday 18 October' }));
  expect(screen.getByRole('heading', { name: 'Sunday 18 October' })).toBeVisible();
  expect(screen.getByText('A clear diary for this day')).toBeVisible();
  fireEvent.click(screen.getAllByRole('button', { name: 'Add appointment' })[0]);
  expect(onAdd).toHaveBeenCalledWith('2026-10-18');
});
it('moves by the current view and Today restores the London date without invoking any record action', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  expect(screen.getByRole('heading', { name: '19 Oct – 25 Oct 2026' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Month' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
  expect(screen.getByRole('heading', { name: 'November 2026' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(screen.getByRole('heading', { name: 'October 2026' })).toBeVisible();
  expect(onEdit).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled();
});
it('keeps overlapping bookings visible and groups late UTC appointments on the London day', () => {
  mount([current, appointment('Overlap'), appointment('Midnight', { appointmentAt: '2026-10-16T23:30:00Z' })]);
  fireEvent.click(screen.getByRole('button', { name: 'Day' }));
  expect(screen.getByRole('button', { name: '00:30, Midnight Customer, Ford Focus, Confirmed' })).toBeVisible();
  expect(screen.getByRole('button', { name: '13:00, Overlap Customer, Ford Focus, Confirmed' })).toBeVisible();
  expect(screen.getByText('3 appointments')).toBeVisible();
});
it('keeps cancelled bookings hidden until requested and filters by customer, status and owner', () => {
  const owner = vi.fn();
  mount([current, pending, cancelled], { onOwnerScopeChange: owner, canChooseMine: true });
  expect(screen.queryByRole('button', { name: /Cancelled Customer/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show cancelled' }));
  expect(screen.getByRole('button', { name: /Cancelled Customer/ })).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Booking status' }), { target: { value: 'pending' } });
  expect(screen.queryByRole('button', { name: /Alex Customer/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Jordan Customer/ })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find an appointment' }), { target: { value: 'does not exist' } });
  expect(screen.queryByRole('button', { name: /Jordan Customer/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Staff' }), { target: { value: 'mine' } });
  expect(owner).toHaveBeenCalledWith('mine');
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByRole('button', { name: /Alex Customer/ })).toBeVisible();
  expect(owner).toHaveBeenLastCalledWith('all');
});
it('retains exception details and opens the original pending record for review', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: /Jordan Customer/ }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Double booked')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Review booking & customer' }));
  expect(onOpen).toHaveBeenCalledWith(pending);
  expect(onEdit).not.toHaveBeenCalled();
});
it('uses explicit change and vehicle buttons, and removes modification actions for cancelled records', () => {
  const { unmount } = mount();
  fireEvent.click(screen.getByRole('button', { name: /Alex Customer/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Change or cancel appointment' }));
  expect(onEdit).toHaveBeenCalledWith(current);
  unmount();
  mount([cancelled]);
  fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show cancelled' }));
  fireEvent.click(screen.getByRole('button', { name: /Cancelled Customer/ }));
  expect(screen.queryByRole('button', { name: 'Change or cancel appointment' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Vehicle information' }));
  expect(onVehicle).toHaveBeenCalledWith('car-one');
});
it('shows attendance labels and refreshes open detail from new data instead of holding a stale record', () => {
  const arrived = appointment('Alex', { attendance: 'arrived' });
  const { rerender } = mount([arrived]);
  fireEvent.click(screen.getByRole('button', { name: /Alex Customer/ }));
  expect(within(screen.getByRole('dialog')).getByText('Arrived')).toBeVisible();
  rerender(<EnquiryCalendar entries={[{ ...arrived, attendance: 'completed' }]} onEdit={onEdit} onVehicle={onVehicle} />);
  expect(within(screen.getByRole('dialog')).getByText('Visit completed')).toBeVisible();
  rerender(<EnquiryCalendar entries={[]} onEdit={onEdit} onVehicle={onVehicle} />);
  expect(screen.getByRole('heading', { name: 'Appointment unavailable' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Change or cancel appointment' })).not.toBeInTheDocument();
});
it('reports corrupt appointment dates instead of crashing or claiming a completely clear diary', () => {
  mount([appointment('Corrupt', { appointmentAt: 'not a date' })]);
  expect(screen.getByRole('alert')).toHaveTextContent('1 appointment has an unreadable date');
  expect(screen.getByText('0 appointments')).toBeVisible();
});
it('provides a refresh action and handles a failed car photo without a broken image', () => {
  const refresh = vi.fn();
  mount([current], { onRefresh: refresh });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh appointments' }));
  expect(refresh).toHaveBeenCalledOnce();
  const image = screen.getByRole('button', { name: /Alex Customer/ }).querySelector('img')!;
  fireEvent.error(image);
  expect(screen.getByRole('button', { name: /Alex Customer/ }).querySelector('img')).toBeNull();
});

it('closes the appointment detail with Escape without editing or opening a customer', () => {
  mount([current]);
  fireEvent.click(screen.getByRole('button', { name: /Alex Customer/ }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled();
});
it('loads preparation only for the opened appointment and links its exact declaration workspace', async () => {
  mount();
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /Alex Customer/ }));
  expect(await screen.findByText('Declaration needed')).toBeVisible();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(state.fetch).toHaveBeenCalledWith('/api/staff/enquiries/Alex/test-drive-declarations', {});
  expect(screen.getByRole('link', { name: 'Review declaration & checks' })).toHaveAttribute('href', '/portal?section=notifications&workView=test-drives&enquiryId=Alex');
  expect(onEdit).not.toHaveBeenCalled();
});
it('keeps account staff appointment details accessible without declaration links or requests', () => {
  state.permissions = ['sales.view', 'finance.export'];
  mount();
  fireEvent.click(screen.getByRole('button', { name: /Alex Customer/ }));
  expect(screen.getByRole('heading', { name: 'Alex Customer' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Review declaration & checks' })).not.toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});
