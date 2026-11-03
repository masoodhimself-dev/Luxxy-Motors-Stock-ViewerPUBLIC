import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createSaleWorkspace, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { SaleReturnInspection } from './sale-return-inspection';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => mocks.api(...args), HttpApiError: class extends Error {} }));
function fixture(): SaleWorkspaceRecord {
  const sale = createSaleWorkspace({ requestId: 'fixture-start', draft: { customer: 'Fictional buyer', vehicleId: 'car-1', vehicle: 'Ford Focus', registration: 'AB20XYZ', price: '10000' } }, { now: '2026-11-03T15:00:00Z', actor: 'Fixture', nextId: () => 'sale-test', nextNumber: () => 'TEST', branding: { identity: { name: 'Test Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } } }, 'SALE-42').sale;
  sale.lifecycle = { status: 'returned', vehicleId: 'car-1', changedAt: '2026-11-03T15:00:00Z' };
  sale.returnReplacement = { direction: 'returned', transferId: 'credit', otherSaleId: 'replacement', otherReference: 'SALE-43', creditPence: 1000000, reason: 'Change car', condition: 'Returned', mileage: 45000, at: '2026-11-03T15:00:00Z', actor: 'Fixture' }; return sale;
}
const fill = () => { fireEvent.change(screen.getByLabelText('Inspection note'), { target: { value: 'Keys and paperwork checked.' } }); fireEvent.click(screen.getByLabelText('I have inspected the returned vehicle and it is ready to advertise.')); };
beforeEach(() => { mocks.api.mockReset(); });
it('folds inspection fields and requires a note and separate confirmation', () => {
  render(<SaleReturnInspection sale={fixture()} onChange={vi.fn()}/>);
  expect(screen.getByText('Complete inspection').closest('details')).not.toHaveAttribute('open');
  const button = screen.getByRole('button', { name: 'Record inspection & make available', hidden: true }); expect(button).toBeDisabled();
  fireEvent.click(screen.getByText('Complete inspection')); expect(screen.getByText(/A listing archived after the previous sale will also be restored/)).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Inspection note'), { target: { value: 'Inspected.' } }); expect(button).toBeDisabled();
  fireEvent.click(screen.getByLabelText('I have inspected the returned vehicle and it is ready to advertise.')); expect(button).toBeEnabled(); expect(mocks.api).not.toHaveBeenCalled();
});
it('saves one inspection with its exact revision and passes the saved returned deal to the parent', async () => {
  const sale = fixture(), onChange = vi.fn(), saved = { ...sale, revision: sale.revision + 1, returnInspection: { at: '2026-11-03T15:30:00Z', actor: 'Inspector', note: 'Keys and paperwork checked.' } }; mocks.api.mockResolvedValue({ sale: saved });
  render(<SaleReturnInspection sale={sale} onChange={onChange}/>); fireEvent.click(screen.getByText('Complete inspection')); fill(); fireEvent.click(screen.getByRole('button', { name: 'Record inspection & make available' }));
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved)); expect(mocks.api.mock.calls[0][0]).toBe('/api/sale-return-inspection/sale-test'); expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toMatchObject({ confirm: true, expectedRevision: sale.revision, note: 'Keys and paperwork checked.' });
});
it('preserves entered details and reuses the request after an uncertain failure', async () => {
  mocks.api.mockRejectedValue(new Error('Connection interrupted')); render(<SaleReturnInspection sale={fixture()} onChange={vi.fn()}/>); fireEvent.click(screen.getByText('Complete inspection')); fill();
  fireEvent.click(screen.getByRole('button', { name: 'Record inspection & make available' })); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Record inspection & make available' })); await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2));
  expect(JSON.parse(mocks.api.mock.calls[0][1].body).requestId).toBe(JSON.parse(mocks.api.mock.calls[1][1].body).requestId); expect(screen.getByLabelText('Inspection note')).toHaveValue('Keys and paperwork checked.');
});
it('does not submit twice or overwrite a newer saved deal', async () => {
  let resolve!: (value: unknown) => void; mocks.api.mockImplementation(() => new Promise(r => { resolve = r; })); const sale = fixture(), onChange = vi.fn(), view = render(<SaleReturnInspection sale={sale} onChange={onChange}/>); fireEvent.click(screen.getByText('Complete inspection')); fill(); const button = screen.getByRole('button', { name: 'Record inspection & make available' }); fireEvent.click(button); fireEvent.click(button); expect(mocks.api).toHaveBeenCalledTimes(1);
  view.rerender(<SaleReturnInspection sale={{ ...sale, revision: sale.revision + 3 }} onChange={onChange}/>); await act(async () => resolve({ sale: { ...sale, revision: sale.revision + 1, returnInspection: { at: '2026-11-03T15:30:00Z', actor: 'Inspector', note: 'Checked' } } })); expect(screen.getByRole('alert')).toHaveTextContent('deal changed'); expect(onChange).not.toHaveBeenCalled();
});
it('shows saved inspection history and keeps unauthorised staff out of the action', () => {
  const sale = fixture(), view = render(<SaleReturnInspection sale={sale} onChange={vi.fn()} canInspect={false}/>); expect(screen.queryByText('Complete inspection')).not.toBeInTheDocument(); expect(screen.getByText(/permission to manage sales/)).toBeInTheDocument();
  view.rerender(<SaleReturnInspection sale={{ ...sale, returnInspection: { at: '2026-11-03T15:30:00Z', actor: 'Inspector', note: 'Recorded condition' } }} onChange={vi.fn()}/>); expect(screen.getByText('Inspection recorded')).toBeInTheDocument(); expect(screen.getByText('Recorded condition')).toBeInTheDocument(); expect(screen.queryByText('Complete inspection')).not.toBeInTheDocument();
});
