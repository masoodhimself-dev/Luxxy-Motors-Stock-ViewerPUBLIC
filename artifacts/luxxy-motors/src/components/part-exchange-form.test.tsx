import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { partExchangeDraftKey } from '@/lib/part-exchange-draft';
import { PartExchangeForm } from './part-exchange-form';

const featureState = vi.hoisted(() => ({ allowed: true, isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ ...featureState, enabled: () => featureState.allowed }) }));
const mutation = vi.hoisted(() => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isSuccess: false, isError: false, data: undefined }));
vi.mock('@workspace/api-client-react', () => ({ useCreateEnquiry: () => mutation }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: dealerConfig }) }));
vi.mock('@/lib/visitor', () => ({ getVisitorId: () => 'test-visitor' }));
const car = { id: 'stock-1', title: 'Ford Focus', make: 'Ford', model: 'Focus', price: 7490, year: 2019, images: [] } as unknown as Car;
beforeEach(() => { sessionStorage.clear(); vi.clearAllMocks(); mutation.isSuccess = false; featureState.allowed = true; featureState.isError = false; featureState.isLoading = false; });

describe('short part exchange journey', () => {
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
