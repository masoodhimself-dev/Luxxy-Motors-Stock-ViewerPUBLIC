import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SaleInvoiceVehicleReview, SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { InvoiceVehicleReview } from './invoice-vehicle-review';

const fetchReview = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch: fetchReview, HttpApiError: class extends Error {} }));

const sale = { id: 'sale-1', revision: 7, draft: { vehicle: 'BMW 2 Series', registration: 'LM18JTX' } } as SaleWorkspaceRecord;
const checkedAt = '2026-11-12T10:00:00.000Z';
const checked: SaleInvoiceVehicleReview = {
  id: 'check-1', registration: 'LM18JTX', checkedAt, status: 'checked', warnings: [],
  dvla: { make: 'BMW', colour: 'Blue', checkedAt },
  mot: { expiryDate: '2027-06-30', source: 'DVSA', checkedAt },
  lastMotMileage: { reading: 62000, unit: 'miles', recordedAt: '2026-07-01' },
  stockMileage: 64500,
};

beforeEach(() => fetchReview.mockReset());

it('requires the current odometer to be entered and confirmed after the official lookup', async () => {
  fetchReview.mockResolvedValue({ review: checked });
  const onApproval = vi.fn();
  render(<InvoiceVehicleReview sale={sale} onApproval={onApproval} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check DVLA and MOT' }));
  const mileage = await screen.findByRole('textbox', { name: 'Current odometer (miles)' });
  expect(mileage).toHaveValue('');
  expect(screen.getByText('62,000 miles')).toBeVisible();
  expect(screen.getByText('64,500 miles')).toBeVisible();
  expect(screen.getByText('30 Jun 2027')).toBeVisible();
  expect(fetchReview).toHaveBeenCalledWith('/api/sale-workspace/sale-1/invoice-vehicle-review',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ expectedRevision: 7 }) }));
  const confirm = screen.getByRole('checkbox', { name: /confirmed the current odometer reading/ });
  expect(confirm).toBeDisabled();
  fireEvent.change(mileage, { target: { value: '61,999' } });
  expect(screen.getByText(/lower than the last MOT/)).toBeVisible();
  fireEvent.change(mileage, { target: { value: '65,000' } });
  fireEvent.click(confirm);
  expect(onApproval).toHaveBeenLastCalledWith({ saleId: sale.id, revision: sale.revision, id: checked.id, mileage: 65000, acknowledge: true });
  fireEvent.change(mileage, { target: { value: '2,000,001' } });
  expect(confirm).toBeDisabled();
  expect(confirm).not.toBeChecked();
  expect(onApproval).toHaveBeenLastCalledWith(null);
});

it('allows explicitly confirmed manual checking after provider outage', async () => {
  fetchReview.mockResolvedValue({ review: {
    id: 'unavailable-review', status: 'unavailable', registration: '', checkedAt, warnings: ['DVLA and DVSA could not be checked.'],
  } });
  const onApproval = vi.fn();
  render(<InvoiceVehicleReview sale={sale} onApproval={onApproval} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check DVLA and MOT' }));
  const mileage = await screen.findByRole('textbox', { name: 'Current odometer (miles)' });
  expect(screen.getByText('Check the vehicle and odometer manually.')).toBeVisible();
  expect(screen.queryByText(/DVLA vehicle details/)).not.toBeInTheDocument();
  fireEvent.change(mileage, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /checked the vehicle manually/ }));
  expect(onApproval).toHaveBeenLastCalledWith({ saleId: sale.id, revision: sale.revision, id: 'unavailable-review', mileage: 0, acknowledge: true });
});

it('clears an earlier confirmation when checks are rerun and shows a retry on a transport failure', async () => {
  fetchReview.mockResolvedValueOnce({ review: checked }).mockRejectedValueOnce(new Error('No network'));
  const onApproval = vi.fn();
  render(<InvoiceVehicleReview sale={sale} onApproval={onApproval} />);
  fireEvent.click(screen.getByRole('button', { name: 'Check DVLA and MOT' }));
  const mileage = await screen.findByRole('textbox', { name: 'Current odometer (miles)' });
  fireEvent.change(mileage, { target: { value: '64000' } });
  fireEvent.click(screen.getByRole('checkbox', { name: /confirmed the current odometer reading/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not start the vehicle check.');
  expect(onApproval).toHaveBeenLastCalledWith(null);
  expect(screen.getByRole('button', { name: 'Check DVLA and MOT' })).toBeEnabled();
});
