import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
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
beforeEach(() => { state.stock = null; state.isLoading = true; state.error = null; state.form.mockClear(); });

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

it('keeps a failed initial part-exchange stock load out of the form while retaining general-enquiry access', () => {
  window.history.pushState({}, '', '/enquire?type=part_exchange&vehicleId=requested-car');
  state.isLoading = false; state.error = 'Stock unavailable';
  const view = render(<Enquire />);
  expect(screen.getByTestId('status-stock-error')).toBeInTheDocument(); expect(screen.queryByTestId('enquiry-form-under-test')).not.toBeInTheDocument();
  view.unmount(); window.history.pushState({}, '', '/enquire?type=general'); render(<Enquire />);
  expect(screen.getByTestId('enquiry-form-under-test')).toHaveAttribute('data-type', 'general');
});
