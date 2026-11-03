import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createSaleWorkspace, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import type { Car } from '@/lib/stock-context';
import { SaleReturnReplace, SaleReplacementRefund } from './sale-return-replace';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => mocks.api(...args) }));
const branding = { identity: { name: 'Test Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } };
let serial = 0;
function fixture(): SaleWorkspaceRecord {
  const sale = createSaleWorkspace({ requestId: 'start-sale', draft: { customer: 'Alex Morgan', email: 'alex@example.test', vehicleId: 'car-1', vehicle: 'Ford Focus', registration: 'AB20XYZ', price: '10000' } }, { now: '2026-11-03T14:00:00Z', actor: 'Staff', nextId: () => `item-${++serial}`, nextNumber: () => 'TEST-1', branding }, 'SALE-1042').sale;
  sale.id = 'sale-test'; sale.completedAt = '2026-11-01T12:00:00Z'; sale.lifecycle = { status: 'sold', vehicleId: 'car-1', changedAt: sale.completedAt };
  sale.payments = [{ id: 'payment-1', amount: '10000', amountPence: 1000000, signedAmountPence: 1000000, kind: 'final-payment', status: 'confirmed', method: 'Bank transfer', date: '2026-11-01', reference: '', recordedAt: sale.completedAt, recordedBy: 'Staff' }]; return sale;
}
const cars = [
  { id: 'car-2', make: 'Toyota', model: 'Corolla', title: 'Toyota Corolla', plate: 'XY20ABC', year: 2020, price: 12000, inventoryStatus: 'available' },
  { id: 'car-3', make: 'Honda', model: 'Civic', title: 'Honda Civic', plate: 'BB20CDE', year: 2020, price: 8500, inventoryStatus: 'available' },
  { id: 'car-sold', make: 'Ford', model: 'Fiesta', title: 'Ford Fiesta', plate: 'AB19XYZ', inventoryStatus: 'sold', price: 7000 },
] as unknown as Car[];
function reviewed(sale: SaleWorkspaceRecord, status = 'passed') { const saved = { ...sale, revision: sale.revision + 1 }; return { sale: saved, proposalKey: 'proposal-hash', review: { id: 'review-1', checkedAt: '2026-11-03T14:30:00Z', reviewedRevision: saved.revision, status, issues: [], summary: 'The proposed figures are consistent.' } }; }
function fill(price = '12000') {
  fireEvent.click(screen.getByRole('button', { name: 'Return & replace' })); fireEvent.click(screen.getByRole('button', { name: /Toyota Corolla/ }));
  fireEvent.change(screen.getByLabelText('Agreed replacement price (£)'), { target: { value: price } }); fireEvent.change(screen.getByLabelText('Returned mileage (miles)'), { target: { value: '45123' } });
  fireEvent.change(screen.getByLabelText('Reason for return'), { target: { value: 'Customer needs a different vehicle.' } }); fireEvent.change(screen.getByLabelText('Returned vehicle condition'), { target: { value: 'Inspected, no new damage, two keys received.' } });
  fireEvent.click(screen.getByLabelText('Finance and any third-party settlement have been resolved.'));
}
beforeEach(() => { mocks.api.mockReset(); serial = 0; });
it.each([['12000', 'Extra amount to pay', '£2,000.00'], ['10000', 'Nothing further to pay', '£0.00'], ['8500', 'Refund due to customer', '£1,500.00']])('compares %s replacement exactly without moving money', (price, label, amount) => {
  render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>); fill(price); expect(screen.getByText(label).parentElement).toHaveTextContent(amount); expect(mocks.api).not.toHaveBeenCalled();
});
it('searches only available stock and announces an empty search', () => {
  render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>); fireEvent.click(screen.getByRole('button', { name: 'Return & replace' }));
  expect(screen.queryByRole('button', { name: /Ford Fiesta/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Replacement car' }), { target: { value: 'BB20 CDE' } }); expect(screen.getByRole('button', { name: /Honda Civic/ })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Toyota Corolla/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Replacement car' }), { target: { value: 'unlisted' } }); expect(screen.getByText('No available cars match. Try another make or registration.')).toBeInTheDocument();
});
it('reviews the proposal first and requires separate final confirmation', async () => {
  const sale = fixture(), checked = reviewed(sale), onSaved = vi.fn(); mocks.api.mockResolvedValueOnce(checked);
  const returned: SaleWorkspaceRecord = { ...checked.sale, revision: checked.sale.revision + 1, lifecycle: { status: 'returned', vehicleId: 'car-1', changedAt: '2026-11-03T14:00:00Z' }, returnReplacement: { transferId: 'transfer-1', direction: 'returned', otherSaleId: 'replacement-1', otherReference: 'SALE-1043', creditPence: 1000000, reason: 'Changed car', condition: 'Good', mileage: 45123, at: '2026-11-03T14:00:00Z', actor: 'Staff' } }; mocks.api.mockResolvedValueOnce({ sale: returned, replacementId: 'replacement-1' });
  render(<SaleReturnReplace sale={sale} cars={cars} onSaved={onSaved} onOpenSale={vi.fn()}/>); fill(); fireEvent.click(screen.getByRole('button', { name: 'Check proposed exchange' })); await screen.findByText('Exchange checks passed');
  expect(mocks.api).toHaveBeenCalledTimes(1); expect(mocks.api.mock.calls[0][0]).toMatch(/replacement-review$/); const confirm = screen.getByRole('button', { name: 'Confirm return & create replacement' }); expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByLabelText(/I confirm the customer’s agreed return/)); fireEvent.click(confirm); await waitFor(() => expect(onSaved).toHaveBeenCalledWith(returned));
  expect(mocks.api.mock.calls[1][0]).toMatch(/return-replace$/); expect(JSON.parse(mocks.api.mock.calls[1][1].body)).toMatchObject({ expectedRevision: checked.sale.revision, proposalKey: 'proposal-hash', replacementVehicleId: 'car-2', replacementPrice: '12000', agreedCredit: '10000.00', mileage: 45123, financeConfirmed: true, acknowledge: true });
});
it('invalidates a check after an edited price and keeps the return details', async () => {
  mocks.api.mockResolvedValue(reviewed(fixture())); render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>); fill(); fireEvent.click(screen.getByRole('button', { name: 'Check proposed exchange' })); await screen.findByText('Exchange checks passed');
  fireEvent.change(screen.getByLabelText('Agreed replacement price (£)'), { target: { value: '11000' } }); expect(screen.getByText('The proposal changed. Check it again.')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Confirm return & create replacement' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Reason for return')).toHaveValue('Customer needs a different vehicle.');
});
it('keeps parent edits and refuses to overwrite a newer saved revision', async () => {
  let resolve!: (result: unknown) => void; mocks.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  const sale = fixture(), onSaved = vi.fn(), view = render(<SaleReturnReplace sale={sale} cars={cars} onSaved={onSaved} onOpenSale={vi.fn()}/>); fill(); fireEvent.click(screen.getByRole('button', { name: 'Check proposed exchange' })); expect(screen.getByText('Please wait while AI checks the proposed exchange…')).toBeInTheDocument();
  view.rerender(<SaleReturnReplace sale={{ ...sale, revision: sale.revision + 3 }} cars={cars} onSaved={onSaved} onOpenSale={vi.fn()}/>); await act(async () => resolve(reviewed(sale))); expect(screen.getByRole('alert')).toHaveTextContent('deal changed'); expect(onSaved).not.toHaveBeenCalled(); expect(screen.getByLabelText('Returned mileage (miles)')).toHaveValue('45123');
});
it('keeps entries and request identity after a failed review', async () => {
  mocks.api.mockRejectedValue(new Error('Offline')); render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>); fill(); fireEvent.click(screen.getByRole('button', { name: 'Check proposed exchange' })); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Check exchange again' })); await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2)); expect(JSON.parse(mocks.api.mock.calls[0][1].body).requestId).toEqual(JSON.parse(mocks.api.mock.calls[1][1].body).requestId);
});
it('prevents duplicate confirmation and reuses its identity after an uncertain result', async () => {
  let fail!: (reason: Error) => void; mocks.api.mockResolvedValueOnce(reviewed(fixture())).mockImplementationOnce(() => new Promise((_r, reject) => { fail = reject; })).mockRejectedValueOnce(new Error('Still offline'));
  render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>); fill(); fireEvent.click(screen.getByRole('button', { name: 'Check proposed exchange' })); await screen.findByText('Exchange checks passed'); fireEvent.click(screen.getByLabelText(/I confirm the customer’s agreed return/));
  const confirm = screen.getByRole('button', { name: 'Confirm return & create replacement' }); fireEvent.click(confirm); fireEvent.click(confirm); expect(mocks.api).toHaveBeenCalledTimes(2);
  await act(async () => fail(new Error('Lost response'))); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Confirm return & create replacement' })); await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(3)); expect(JSON.parse(mocks.api.mock.calls[1][1].body).requestId).toEqual(JSON.parse(mocks.api.mock.calls[2][1].body).requestId);
});
it('blocks actions with unsaved edits or missing permission', () => {
  const onSaved = vi.fn(), view = render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={onSaved} onOpenSale={vi.fn()} disabled/>); expect(screen.getByRole('button', { name: 'Return & replace' })).toBeDisabled();
  view.rerender(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={onSaved} onOpenSale={vi.fn()} canReturn={false}/>); expect(screen.getByRole('button', { name: 'Return & replace' })).toBeDisabled(); expect(mocks.api).not.toHaveBeenCalled();
});
it('links to the replacement rather than allowing another return', () => {
  const sale = fixture(); sale.returnReplacement = { direction: 'returned', otherSaleId: 'replacement-1', otherReference: 'SALE-1043', creditPence: 1000000 } as NonNullable<SaleWorkspaceRecord['returnReplacement']>;
  const open = vi.fn(); render(<SaleReturnReplace sale={sale} cars={cars} onSaved={vi.fn()} onOpenSale={open}/>); expect(screen.queryByRole('button', { name: 'Return & replace' })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: /Open replacement SALE-1043/ })); expect(open).toHaveBeenCalledWith('replacement-1');
});
function replacementSale() {
  const sale = fixture(); sale.completedAt = undefined; sale.lifecycle!.status = 'reserved'; sale.payments = []; sale.draft.price = '8500'; sale.draft.creditEntries = [{ id: 'credit-1', sourceSaleId: 'original-1', reference: 'SALE-1041', signedAmountPence: 1000000, at: '2026-11-03T14:00:00Z' }]; sale.returnReplacement = { direction: 'replacement', otherSaleId: 'original-1', otherReference: 'SALE-1041', creditPence: 1000000 } as NonNullable<SaleWorkspaceRecord['returnReplacement']>; return sale;
}
it('records an already paid partial refund and retains the remaining credit', async () => {
  const sale = replacementSale(), saved = structuredClone(sale), onSaved = vi.fn(); saved.revision++; saved.payments.push({ id: 'refund-1', amount: '500', amountPence: 50000, signedAmountPence: -50000, kind: 'refund', status: 'confirmed', method: 'Bank transfer', date: '2026-11-03', reference: '', recordedAt: '2026-11-03T15:00:00Z', recordedBy: 'Staff' }); mocks.api.mockResolvedValue({ sale: saved });
  render(<SaleReplacementRefund sale={sale} onSaved={onSaved}/>); expect(screen.getByText('Customer credit: £1,500.00')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Record refunded credit' })); fireEvent.change(screen.getByLabelText('Refund amount (£)'), { target: { value: '500' } }); expect(screen.getByRole('button', { name: 'Record confirmed refund' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('I have checked that this refund has actually been paid to the customer.')); fireEvent.click(screen.getByRole('button', { name: 'Record confirmed refund' })); await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved)); expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toMatchObject({ amount: '500', method: 'Bank transfer', confirmReceived: true, expectedRevision: sale.revision }); expect(saleWorkspaceTotals(saved.draft, saved.payments).balance).toBe(-100000);
});
it('blocks excessive credit refunds', () => {
  render(<SaleReplacementRefund sale={replacementSale()} onSaved={vi.fn()}/>); fireEvent.click(screen.getByRole('button', { name: 'Record refunded credit' })); fireEvent.change(screen.getByLabelText('Refund amount (£)'), { target: { value: '1500.01' } }); fireEvent.click(screen.getByLabelText('I have checked that this refund has actually been paid to the customer.')); expect(screen.getByRole('button', { name: 'Record confirmed refund' })).toBeDisabled(); expect(mocks.api).not.toHaveBeenCalled();
});
it('retains refund request identity after a lost result', async () => {
  mocks.api.mockRejectedValue(new Error('Offline')); render(<SaleReplacementRefund sale={replacementSale()} onSaved={vi.fn()}/>); fireEvent.click(screen.getByRole('button', { name: 'Record refunded credit' })); fireEvent.click(screen.getByLabelText('I have checked that this refund has actually been paid to the customer.')); fireEvent.click(screen.getByRole('button', { name: 'Record confirmed refund' })); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Record confirmed refund' })); await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2)); expect(JSON.parse(mocks.api.mock.calls[0][1].body).requestId).toEqual(JSON.parse(mocks.api.mock.calls[1][1].body).requestId);
});
it('keeps a folded return draft marked unsaved and retains its entries when reopened', async () => {
  const dirty = vi.fn(); render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()} onDirtyChange={dirty}/>); fill();
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true)); fireEvent.click(screen.getByRole('button', { name: 'Fold details' })); expect(dirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: 'Return & replace' })); expect(screen.getByLabelText('Returned vehicle condition')).toHaveValue('Inspected, no new damage, two keys received.');
});
it('can propose another replacement after a completed replacement purchase, keeping the earlier sale link', () => {
  const sale = fixture(); sale.returnReplacement = { direction: 'replacement', otherSaleId: 'previous-sale', otherReference: 'SALE-1001', creditPence: 1000000 } as NonNullable<SaleWorkspaceRecord['returnReplacement']>;
  render(<SaleReturnReplace sale={sale} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>); expect(screen.getByRole('button', { name: 'Return & replace' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Open original sale' })).toBeInTheDocument();
});
it('refuses to apply a review response when the main deal has new unsaved edits', async () => {
  let resolve!: (result: unknown) => void; mocks.api.mockImplementation(() => new Promise(r => { resolve = r; })); const sale = fixture(), onSaved = vi.fn();
  const view = render(<SaleReturnReplace sale={sale} cars={cars} onSaved={onSaved} onOpenSale={vi.fn()}/>); fill(); fireEvent.click(screen.getByRole('button', { name: 'Check proposed exchange' }));
  view.rerender(<SaleReturnReplace sale={sale} cars={cars} onSaved={onSaved} onOpenSale={vi.fn()} disabled/>); await act(async () => resolve(reviewed(sale))); expect(screen.getByRole('alert')).toHaveTextContent('Save any changes'); expect(onSaved).not.toHaveBeenCalled();
});
it('fails closed after an unavailable proposal check without offering confirmation', async () => {
  mocks.api.mockResolvedValue(reviewed(fixture(), 'unavailable')); render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>); fill(); fireEvent.click(screen.getByRole('button', { name: 'Check proposed exchange' })); await screen.findByText('Exchange check unavailable'); expect(screen.queryByRole('button', { name: 'Confirm return & create replacement' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Check exchange again' })).toBeEnabled();
});
it('records a staff override with a reason, then still requires exchange confirmation', async () => {
  const checked=reviewed(fixture(),'overridden');Object.assign(checked.review,{issues:[{field:'invoices',severity:'warning',message:'Check warranty cover before confirming.'}],override:{actor:'Dealer manager',reason:'Checked the return agreement directly.',at:'2026-11-03T16:00:00Z',ignoredReview:{id:'original-ai-review',status:'attention',summary:'Confirm the warranty duration with the provider.',issues:[{field:'invoices',severity:'warning',message:'Check warranty cover before confirming.'}],model:'fixture-luna',checkedAt:'2026-11-03T15:58:00Z'}}});mocks.api.mockResolvedValue(checked);
  render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>);fill();fireEvent.click(screen.getByRole('button',{name:'Continue without AI'}));
  expect(screen.getByRole('button',{name:'Record staff override'})).toBeDisabled();fireEvent.change(screen.getByLabelText('Reason for staff override'),{target:{value:'Checked the return agreement directly.'}});expect(screen.getByRole('button',{name:'Record staff override'})).toBeDisabled();
  fireEvent.click(screen.getByLabelText('I have checked the exchange and want to continue without AI approval.'));fireEvent.click(screen.getByRole('button',{name:'Record staff override'}));await screen.findByText('Staff override recorded');expect(screen.getByText('AI advice overridden')).toBeInTheDocument();expect(screen.getByText('Confirm the warranty duration with the provider.')).toBeInTheDocument();expect(screen.getByText('Check warranty cover before confirming.')).toBeInTheDocument();expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Confirm return & create replacement'})).toBeDisabled();expect(mocks.api.mock.calls[0][0]).toMatch(/override-replacement-review$/);expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toMatchObject({confirm:true,overrideReason:'Checked the return agreement directly.',reason:'Customer needs a different vehicle.'});
});
it('retains staff override retry identity after a lost result', async () => {
  mocks.api.mockRejectedValue(new Error('Offline'));render(<SaleReturnReplace sale={fixture()} cars={cars} onSaved={vi.fn()} onOpenSale={vi.fn()}/>);fill();fireEvent.click(screen.getByRole('button',{name:'Continue without AI'}));fireEvent.change(screen.getByLabelText('Reason for staff override'),{target:{value:'Manager checked all details.'}});fireEvent.click(screen.getByLabelText('I have checked the exchange and want to continue without AI approval.'));fireEvent.click(screen.getByRole('button',{name:'Record staff override'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Record staff override'}));await waitFor(()=>expect(mocks.api).toHaveBeenCalledTimes(2));expect(JSON.parse(mocks.api.mock.calls[0][1].body).requestId).toBe(JSON.parse(mocks.api.mock.calls[1][1].body).requestId);
});
