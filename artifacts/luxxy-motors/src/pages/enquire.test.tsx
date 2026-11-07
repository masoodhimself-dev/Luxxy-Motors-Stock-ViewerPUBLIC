import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import { getEnquiryHref } from '@/lib/cta-helpers';
import Enquire from './enquire';

const state = vi.hoisted(() => ({ stock: null as null | { cars: Array<{ id: string; title: string; make: string; model: string; images: [] }> }, isLoading: true, error: null as string | null, form: vi.fn() }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => state }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: dealerConfig }) }));
vi.mock('@/hooks/use-page-meta', () => ({ usePageMeta: () => {} }));
vi.mock('@/components/test-drive-booking', () => ({ TestDriveBooking: () => null }));
vi.mock('@/components/vehicle-call', () => ({ VehicleCall: () => null }));
vi.mock('@/components/enquiry-form', () => ({ EnquiryForm: (props: { vehicle?: { id: string; title: string }; initialType: string }) => {
  state.form(props);
  return <div data-testid="enquiry-form-under-test" data-vehicle={props.vehicle?.id ?? ''} data-type={props.initialType}><input aria-label="Example registration" /></div>;
} }));
const car = { id: 'requested-car', title: 'Ford Focus', make: 'Ford', model: 'Focus', images: [] as [] };
beforeEach(() => { window.sessionStorage.clear(); state.stock = null; state.isLoading = true; state.error = null; state.form.mockClear(); });

it('waits for initial stock before mounting part exchange with the requested vehicle, preserving later input on stock refresh', () => {
  window.history.pushState({}, '', '/enquire?type=part_exchange&vehicleId=requested-car');
  const view = render(<Enquire />);
  expect(screen.getByTestId('loading-enquiry-vehicle')).toBeInTheDocument();
  expect(screen.queryByTestId('enquiry-form-under-test')).not.toBeInTheDocument(); expect(state.form).not.toHaveBeenCalled();
  state.stock = { cars: [car] }; state.isLoading = false; view.rerender(<Enquire />);
  expect(screen.getByTestId('enquiry-form-under-test')).toHaveAttribute('data-vehicle', 'requested-car');
  fireEvent.change(screen.getByRole('textbox', { name: 'Example registration' }), { target: { value: 'AB12 CDE' } });
  state.stock = { cars: [{ ...car }] }; view.rerender(<Enquire />);
  expect(screen.getByRole('textbox', { name: 'Example registration' })).toHaveValue('AB12 CDE');
  state.error = 'Background refresh failed'; view.rerender(<Enquire />);
  expect(screen.getByRole('textbox', { name: 'Example registration' })).toHaveValue('AB12 CDE');
});

it('keeps part exchange available without a selected car when the stock load fails', () => {
  window.history.pushState({}, '', '/enquire?type=part_exchange&vehicleId=requested-car');
  state.isLoading = false; state.error = 'Stock unavailable';
  const view = render(<Enquire />);
  expect(screen.getByTestId('status-stock-error')).toBeInTheDocument();
  expect(screen.getByTestId('enquiry-form-under-test')).toHaveAttribute('data-type', 'part_exchange');
  expect(screen.getByTestId('enquiry-form-under-test')).toHaveAttribute('data-vehicle', '');
  view.unmount(); window.history.pushState({}, '', '/enquire?type=general'); render(<Enquire />);
  expect(screen.getByTestId('enquiry-form-under-test')).toHaveAttribute('data-type', 'general');
});

it('hands service questions to the form as editable requests without depending on stock', () => {
  const message = 'Could you tell me what warranty is included?';
  window.history.pushState({}, '', getEnquiryHref('general', undefined, message));
  render(<Enquire />);
  expect(screen.queryByTestId('loading-enquiry-vehicle')).not.toBeInTheDocument();
  expect(state.form.mock.calls.at(-1)?.[0]).toMatchObject({
    initialType: 'general', initialMessage: '', messageRequest: { text: message },
  });
});

it('waits for a requested message vehicle before mounting the form and keeps input on stock refresh', () => {
  window.history.pushState({}, '', '/enquire?type=general&vehicleId=requested-car');
  const view = render(<Enquire />);
  expect(screen.getByTestId('loading-enquiry-vehicle')).toBeInTheDocument();
  expect(state.form).not.toHaveBeenCalled();
  state.stock = { cars: [car] }; state.isLoading = false;
  view.rerender(<Enquire />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ask about this car');
  expect(screen.getByRole('link', { name: 'Back to car' })).toHaveAttribute('href', '/vehicle/requested-car');
  expect(screen.getByTestId('enquiry-form-under-test')).toHaveAttribute('data-vehicle', car.id);
  fireEvent.change(screen.getByRole('textbox', { name: 'Example registration' }), { target: { value: 'Customer draft' } });
  state.stock = { cars: [{ ...car }] }; state.isLoading = true;
  view.rerender(<Enquire />);
  expect(screen.getByRole('textbox', { name: 'Example registration' })).toHaveValue('Customer draft');
  expect(screen.queryByTestId('loading-enquiry-vehicle')).not.toBeInTheDocument();
});

it('lets customers send a general message when a requested car is no longer in stock', () => {
  window.history.pushState({}, '', '/enquire?type=general&vehicleId=gone-car');
  state.stock = { cars: [car] }; state.isLoading = false;
  render(<Enquire />);
  expect(screen.getByTestId('status-vehicle-unavailable')).toBeInTheDocument();
  expect(screen.getByTestId('enquiry-form-under-test')).toHaveAttribute('data-vehicle', '');
  expect(screen.getByRole('link', { name: 'Back to showroom' })).toHaveAttribute('href', '/');
});

it('changes car in a picker without remounting the enquiry or navigating through stock', () => {
  const toyota = { ...car, id: 'second-car', title: 'Toyota Yaris', make: 'Toyota', model: 'Yaris' };
  window.history.pushState({}, '', '/enquire?type=general&vehicleId=requested-car&question=mot');
  state.stock = { cars: [car, toyota] };state.isLoading = false;
  render(<Enquire />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Example registration' }), { target: { value: 'My unfinished details' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change car' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search available cars' }), { target: { value: 'Toyota' } });
  fireEvent.click(screen.getByRole('button', { name: 'Choose Toyota Yaris' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByTestId('enquiry-form-under-test')).toHaveAttribute('data-vehicle', toyota.id);
  expect(screen.getByRole('textbox', { name: 'Example registration' })).toHaveValue('My unfinished details');
  expect(window.location.pathname).toBe('/enquire');
  expect(new URLSearchParams(window.location.search).get('vehicleId')).toBe(toyota.id);
  expect(new URLSearchParams(window.location.search).has('question')).toBe(false);
  expect(state.form.mock.calls.at(-1)?.[0]).toMatchObject({ carryDraftToVehicleId: toyota.id });
});

it('returns to the selected car’s canonical short path when its public code is available', () => {
  const published = { ...car, sourceExtras: { publicVehicleCode: 'a1b2c3d4' } };
  window.history.pushState({}, '', '/enquire?type=general&vehicleId=requested-car');
  state.stock = { cars: [published] };state.isLoading = false;
  render(<Enquire />);
  expect(screen.getByRole('link', { name: 'Back to car' })).toHaveAttribute('href', '/cars/ford-focus-a1b2c3d4');
});
