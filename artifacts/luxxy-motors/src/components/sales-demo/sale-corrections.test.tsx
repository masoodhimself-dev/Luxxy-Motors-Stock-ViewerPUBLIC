import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { changeSaleWorkspace, createSaleWorkspace, saleWorkspaceBranding, type SaleWorkspaceCommand, type SaleWorkspaceContext, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { SaleCorrections, type SaleCorrectionIssue } from './sale-corrections';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@workspace/api-client-react', async importOriginal => ({ ...await importOriginal<typeof import('@workspace/api-client-react')>(), customFetch: api }));

let serial = 0;
const context = (): SaleWorkspaceContext => ({
  now: new Date().toISOString(), actor: 'Fictional staff', nextId: () => `id-${++serial}`,
  nextNumber: type => `TEST-${type}-${++serial}`, branding: saleWorkspaceBranding({ identity: { name: 'Example dealership' } }),
});
function mutate(sale: SaleWorkspaceRecord, command: SaleWorkspaceCommand) {
  return changeSaleWorkspace(sale, command, { requestId: `request-${++serial}`, expectedRevision: sale.revision }, context());
}
function fixture(options: { paid?: boolean; delivery?: boolean; completed?: boolean } = {}) {
  let sale = createSaleWorkspace({ requestId: 'fictional-create', draft: {
    customer: 'Jamie Taylor', email: 'old@example.test', phone: '07700900123', address: '1 Example Road',
    vehicleId: 'test-car', vehicle: 'Fictional car', registration: 'AB12 XYZ', price: '10000',
    ...(options.delivery ? { deliveryCharge: '100', fulfilment: { method: 'delivery', viewed: 'viewed' } } : {}),
  } }, context(), 'TEST-SALE').sale;
  if (options.paid) sale = mutate(sale, { action: 'payment', payment: { amount: '500', method: 'Bank transfer', date: '2026-01-01', reference: 'PAYMENT-1', kind: 'part-payment', status: 'confirmed' } }).sale;
  sale = mutate(sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }).sale;
  if (options.completed) sale.completedAt = context().now;
  return sale;
}
function view(sale: SaleWorkspaceRecord, initialIssue?: SaleCorrectionIssue) {
  const onSaved = vi.fn(), onClose = vi.fn();
  const props = { sale, initialIssue, onSaved, onClose, canManageSales: true, canRecordPayments: true, canRefundPayments: true };
  return { ...render(<SaleCorrections {...props} />), ...props };
}
function review() {
  fireEvent.click(screen.getByRole('button', { name: 'Review correction' }));
  return screen.getByRole('dialog', { name: 'Review correction' });
}
function save(name = 'I have checked this correction.') {
  fireEvent.click(screen.getByRole('checkbox', { name }));
  fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
}
const sentBody = () => JSON.parse(String(api.mock.calls[0]![1].body));

beforeEach(() => { serial = 0; api.mockReset(); });

it('reviews an open sale contact correction and offers the next invoice only after saving', async () => {
  const sale = fixture();
  const updated = mutate(sale, { action: 'update', draft: { ...sale.draft, email: 'fixed@example.test' } });
  api.mockResolvedValue(updated);
  const { onSaved, onClose } = view(sale);
  fireEvent.click(screen.getByRole('button', { name: /Wrong customer details/ }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'fixed@example.test' } });
  const preview = review();
  expect(within(preview).getAllByText('£10,000.00 to pay')).toHaveLength(2);
  expect(preview).toHaveTextContent('Create an updated invoice after saving');
  expect(preview).toHaveTextContent(sale.documents[0]!.number);
  expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
  expect(api).not.toHaveBeenCalled();
  save();
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(api).toHaveBeenCalledWith(`/api/sale-workspace/${sale.id}`, expect.objectContaining({ method: 'PUT' }));
  expect(sentBody()).toMatchObject({ expectedRevision: sale.revision, draft: { email: 'fixed@example.test' } });
  expect(onSaved).toHaveBeenCalledWith(updated.sale, undefined, 'updated-invoice');
  expect(updated.sale.documents[0]!.snapshot.draft.email).toBe('old@example.test');
  expect(onClose).toHaveBeenCalledOnce();
});

it('previews a payment adjustment and saves the difference without changing the original payment', async () => {
  const sale = fixture({ paid: true });
  const original = sale.payments[0]!;
  const { onSaved } = view(sale, 'payment');
  api.mockImplementation(async (_path, options) => {
    const { amount, date, reason, kind } = JSON.parse(String(options.body));
    return mutate(sale, { action: 'reverse', paymentId: original.id, amount, date, reason, kind });
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Payment to correct' }), { target: { value: original.id } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount actually received (£)' }), { target: { value: '400' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Reason for correcting this entry' }), { target: { value: 'Bank shows £400 received' } });
  const preview = review();
  expect(preview).toHaveTextContent('£9,500.00 to pay');
  expect(preview).toHaveTextContent('£9,600.00 to pay');
  expect(preview).toHaveTextContent('A payment adjustment PDF will be saved');
  expect(api).not.toHaveBeenCalled();
  save('I checked the amount against the payment record.');
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith(`/api/sale-workspace/${sale.id}/payments/${original.id}/reverse`, expect.objectContaining({ method: 'POST' }));
  expect(sentBody()).toMatchObject({ amount: '100.00', kind: 'reversal', reason: 'Bank shows £400 received' });
  expect(onSaved.mock.calls[0]![0].payments[0]).toEqual(original);
  expect(onSaved.mock.calls[0]![1].type).toBe('receipt');
});

it('records a proven missing amount as a separate payment with its own receipt', async () => {
  const sale = fixture({ paid: true });
  const original = sale.payments[0]!;
  const { onSaved } = view(sale, 'payment');
  api.mockImplementation(async (_path, options) => mutate(sale, { action: 'payment', payment: JSON.parse(String(options.body)).payment }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Payment to correct' }), { target: { value: original.id } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Amount actually received (£)' }), { target: { value: '650' } });
  const preview = review();
  expect(preview).toHaveTextContent('£9,350.00 to pay');
  expect(preview).toHaveTextContent('A receipt for the additional recorded amount will be saved');
  save('I checked the amount against the payment record.');
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith(`/api/sale-workspace/${sale.id}/payments`, expect.objectContaining({ method: 'POST' }));
  expect(sentBody()).toMatchObject({ payment: { amount: '150.00', status: 'confirmed', reference: original.reference, date: original.date } });
  expect(onSaved.mock.calls[0]![0].payments[0]).toEqual(original);
  expect(onSaved.mock.calls[0]![1].paymentAmountPence).toBe(15000);
});

it('previews the extra charge and separate paperwork for an invoiced delivery increase', async () => {
  const sale = fixture({ delivery: true });
  const { onSaved } = view(sale, 'delivery');
  api.mockResolvedValue({ sale: { ...sale, revision: sale.revision + 1 } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Correct delivery charge (£)' }), { target: { value: '150' } });
  const preview = review();
  expect(preview).toHaveTextContent('£10,100.00 to pay');
  expect(preview).toHaveTextContent('£10,150.00 to pay');
  expect(preview).toHaveTextContent('A separate delivery invoice for £50.00 will be saved');
  save();
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith(`/api/sale-operations/${sale.id}/delivery-charge`, expect.objectContaining({ method: 'POST' }));
  expect(sentBody()).toMatchObject({ amount: '150.00', expectedRevision: sale.revision });
});

it.each(['customer', 'delivery'] as const)('routes a protected %s correction to a note without changing the issued sale', async issue => {
  const sale = fixture({ delivery: true, completed: true });
  const { onSaved } = view(sale, issue);
  api.mockResolvedValue({ sale: { ...sale, revision: sale.revision + 1 } });
  if (issue === 'delivery') fireEvent.change(screen.getByRole('textbox', { name: 'Correct delivery charge (£)' }), { target: { value: '50' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'What needs correcting?' }), { target: { value: 'Check the agreed correction.' } });
  const preview = review();
  expect(within(preview).getAllByText('£10,100.00 to pay')).toHaveLength(2);
  expect(preview).toHaveTextContent('A note will be saved for your manager or accountant');
  save();
  await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(api).toHaveBeenCalledWith(`/api/sale-workspace/${sale.id}/corrections`, expect.objectContaining({ method: 'POST' }));
  expect(sentBody().description).toContain('Check the agreed correction.');
  if (issue === 'delivery') expect(sentBody().description).toContain('£100.00 to £50.00');
});

it('blocks a reviewed save after the sale revision changes', () => {
  const sale = fixture();
  const { rerender, ...props } = view(sale, 'customer');
  fireEvent.change(screen.getByRole('textbox', { name: 'Customer name' }), { target: { value: 'Corrected name' } });
  review();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have checked this correction.' }));
  rerender(<SaleCorrections {...props} sale={{ ...sale, revision: sale.revision + 1 }} />);
  expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
  expect(api).not.toHaveBeenCalled();
});
