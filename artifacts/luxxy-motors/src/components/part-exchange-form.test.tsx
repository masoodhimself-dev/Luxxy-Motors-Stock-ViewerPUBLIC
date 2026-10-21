import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { partExchangeDraftKey } from '@/lib/part-exchange-draft';
import { enquiryDraftKey, saveEnquiryDraft } from '@/lib/enquiry-draft';
import { PartExchangeForm } from './part-exchange-form';

const featureState = vi.hoisted(() => ({ allowed: true, isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ ...featureState, enabled: () => featureState.allowed }) }));
const mutation = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isSuccess: false, isError: false, data: undefined }));
vi.mock('@workspace/api-client-react', () => ({ useCreateEnquiry: () => mutation }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { ...dealerConfig, contact: { ...dealerConfig.contact, whatsapp: '447700900123' } } }) }));
vi.mock('@/lib/visitor', () => ({ getVisitorId: () => 'test-visitor' }));
const car = { id: 'stock-1', title: 'Ford Focus', make: 'Ford', model: 'Focus', price: 7490, year: 2019, images: [] } as unknown as Car;
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); mutation.isSuccess = false; featureState.allowed = true; featureState.isError = false; featureState.isLoading = false; });

describe('short part exchange journey', () => {
  it('matches follow-up photos with customer and vehicle details instead of an internal reference', () => {
    const view = render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
    fireEvent.change(screen.getByTestId('input-part-exchange-registration'), { target: { value: 'AB12 CDE' } });
    fireEvent.change(screen.getByTestId('input-part-exchange-mileage'), { target: { value: '45000' } });
    fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
    fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
    fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Alex Buyer' } });
    fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: '07700 900123' } });
    mutation.isSuccess = true;
    view.rerender(<PartExchangeForm vehicle={car} stockCars={[car]} />);
    const message = new URL(screen.getByTestId('link-part-exchange-photos').getAttribute('href')!).searchParams.get('text');
    expect(message).toContain('My car: AB12 CDE');
    expect(message).toContain('Name: Alex Buyer');
    expect(message).toContain('Phone: 07700 900123');
    expect(message).not.toContain('reference');
    expect(screen.getByTestId('status-part-exchange-success')).not.toHaveTextContent('reference');
    expect(mutation.mutate).not.toHaveBeenCalled();
  });
  it('hides the form when disabled and offers retry after a policy lookup error', () => {
    featureState.allowed = false;
    const view = render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
    expect(screen.getByRole('heading', { name: 'Online part-exchange requests are currently unavailable' })).toBeInTheDocument();
    expect(screen.queryByTestId('input-part-exchange-registration')).not.toBeInTheDocument();
    expect(mutation.mutate).not.toHaveBeenCalled();
    featureState.isError = true; view.rerender(<PartExchangeForm vehicle={car} stockCars={[car]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(featureState.refetch).toHaveBeenCalledTimes(1);
  });
  it('accepts a minimal car brief without inventing condition or requiring extra paperwork', () => {
    render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
    fireEvent.change(screen.getByTestId('input-part-exchange-registration'), { target: { value: 'AB12 CDE' } });
    fireEvent.change(screen.getByTestId('input-part-exchange-mileage'), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
    expect(screen.getByRole('heading', { name: 'Which of our cars caught your eye?' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
    fireEvent.change(screen.getByTestId('input-customer-name'), { target: { value: 'Alex Buyer' } });
    fireEvent.change(screen.getByTestId('input-customer-phone'), { target: { value: '07700 900123' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    const data = mutation.mutate.mock.calls[0][0].data;
    expect(data.partExchange).toEqual({ registration: 'AB12 CDE', mileage: 0, condition: null });
    expect(data.email).toBeNull();
    expect(data.message).not.toContain('Condition:');
    expect(data.message).not.toContain('Service history:');
  });
  it('restores unfinished answers after remount and clears them on discard', async () => {
    const view = render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
    fireEvent.change(screen.getByTestId('input-part-exchange-registration'), { target: { value: 'XY19 ABC' } });
    fireEvent.change(screen.getByTestId('input-part-exchange-mileage'), { target: { value: '45000' } });
    view.unmount();
    render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
    expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('XY19 ABC');
    expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(45000);
    expect(screen.getByText('Your unfinished part-exchange enquiry was restored.')).toBeInTheDocument();
    expect(mutation.mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('');
    await waitFor(() => expect(sessionStorage.getItem(partExchangeDraftKey(car.id))).toBeNull());
  });
});

it('carries typed contact and exchange details into a separate valuation task without sending', () => {
  saveEnquiryDraft(enquiryDraftKey(car.id, 'part_exchange'), {
    customerName: 'Fictional Buyer', email: 'fictional@example.test', phone: '07700900123', preferredContact: 'phone',
    message: 'Original question stays in its enquiry draft', hasPartExchange: true,
    exchange: { registration: 'AB12 CDE', mileage: '42000', notes: 'Two keys' },
  });
  render(<PartExchangeForm vehicle={car} stockCars={[car]} />);
  expect(screen.getByTestId('input-part-exchange-registration')).toHaveValue('AB12 CDE');
  expect(screen.getByTestId('input-part-exchange-mileage')).toHaveValue(42000);
  fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
  fireEvent.click(screen.getByTestId('button-part-exchange-continue'));
  expect(screen.getByTestId('input-customer-name')).toHaveValue('Fictional Buyer');
  expect(screen.getByTestId('input-customer-phone')).toHaveValue('07700900123');
  expect(screen.getByTestId('input-customer-email')).toHaveValue('fictional@example.test');
  expect(mutation.mutate).not.toHaveBeenCalled();
});
