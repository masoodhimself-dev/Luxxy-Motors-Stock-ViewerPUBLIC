import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createSaleWorkspace, requestSalePayment, type SaleWorkspaceRecord, type SalePaymentRequest } from '@workspace/vehicle-meta';
import { SalePaymentRequests } from './sale-payment-requests';
const state = vi.hoisted(() => ({ api: vi.fn(), emailEnabled: true }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.api(...args), HttpApiError: class extends Error {} }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => state.emailEnabled }) }));
const branding = { identity: { name: 'Fictional Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } };
let serial = 0;
const context = () => ({ now: new Date().toISOString(), actor: 'Staff', nextId: () => `item-${++serial}`, nextNumber: () => `PAY-${++serial}`, branding });
function fixture() { return createSaleWorkspace({ requestId: 'create-sale', draft: { customer: 'Jamie Patel', email: 'jamie@example.test', phone: '07700900123', vehicle: 'Ford Focus', vehicleId: 'car-1', registration: 'AB20XYZ', price: '10000' } }, context(), 'SALE-1042').sale; }
function withRequest(sale = fixture()) {
  return requestSalePayment(sale, { kind: 'deposit', amount: '500', dueDate: '2026-12-01', note: '', tokenHash: 'hash', expiresAt: '2099-01-01T00:00:00Z' }, context());
}
beforeEach(() => { serial = 0; state.emailEnabled = true; state.api.mockReset(); });

it('creates the agreed request without sending email or recording received money', async () => {
  const sale = fixture(), mutation = withRequest(sale), onSaved = vi.fn();
  state.api.mockResolvedValue({ sale: mutation.sale, requestId: mutation.request.id, url: `https://dealer.example/payment-request/${'a'.repeat(64)}` });
  render(<SalePaymentRequests sale={sale} onSaved={onSaved}/>);
  fireEvent.click(screen.getByRole('button', { name: 'New request' }));
  fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create payment request' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(mutation.sale));
  expect(state.api).toHaveBeenCalledOnce();
  const [url, options] = state.api.mock.calls[0];
  expect(url).toBe(`/api/sale-operations/${sale.id}/request-payment`);
  expect(JSON.parse(options.body)).toMatchObject({ expectedRevision: sale.revision, kind: 'deposit', amount: '500', note: '' });
  expect(mutation.sale.payments).toHaveLength(0); expect(mutation.sale.lifecycle).toBeUndefined();
});

it('shows the remaining request amount after staff record a partial payment', () => {
  const mutation = withRequest(), sale = structuredClone(mutation.sale);
  sale.payments.push({ id: 'payment-1', amount: '200', amountPence: 20000, signedAmountPence: 20000, kind: 'part-payment', status: 'confirmed', method: 'Bank transfer', date: '2026-11-03', reference: '', recordedAt: new Date().toISOString(), recordedBy: 'Staff' });
  render(<SalePaymentRequests sale={sale} onSaved={vi.fn()}/>);
  expect(screen.getByText('Still to pay:').parentElement).toHaveTextContent('£300.00');
  expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument(); expect(state.api).not.toHaveBeenCalled();
});

it('requires confirmation before invalidating an existing private link', async () => {
  const mutation = withRequest(), onSaved = vi.fn();
  state.api.mockResolvedValue({ sale: mutation.sale, requestId: mutation.request.id, url: `https://dealer.example/payment-request/${'b'.repeat(64)}` });
  render(<SalePaymentRequests sale={mutation.sale} onSaved={onSaved}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Create new link' }));
  const dialog = screen.getByRole('dialog', { name: 'Create a new private link?' });
  expect(dialog).toHaveTextContent('previously shared link'); expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create new link' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(JSON.parse(state.api.mock.calls[0][1].body)).toMatchObject({ paymentRequestId: mutation.request.id, expectedRevision: mutation.sale.revision });
  expect(screen.getByLabelText('Private customer link')).toHaveValue(`https://dealer.example/payment-request/${'b'.repeat(64)}`);
  expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', expect.stringContaining('wa.me/447700900123'));
});

it('cancels a request only after confirmation without deleting its record', async () => {
  const mutation = withRequest(), saved = structuredClone(mutation.sale); saved.paymentRequests![0].status = 'cancelled';
  state.api.mockResolvedValue({ sale: saved }); const onSaved = vi.fn();
  render(<SalePaymentRequests sale={mutation.sale} onSaved={onSaved}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel request' })); expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel payment request' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  expect(state.api.mock.calls[0][0]).toMatch(/\/cancel-request$/); expect(saved.paymentRequests).toHaveLength(1); expect(saved.payments).toHaveLength(0);
});

it('reviews the recipient before an email send and reports the server delivery state', async () => {
  const mutation = withRequest(), saved = structuredClone(mutation.sale);
  saved.emailDeliveries = [{ id: 'mail-1', documentId: mutation.request.documentId, to: saved.draft.email, status: 'prepared', attemptedAt: new Date().toISOString() }];
  state.api.mockResolvedValue({ sale: saved });
  render(<SalePaymentRequests sale={mutation.sale} onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Email PDF' }));
  const dialog = screen.getByRole('dialog', { name: 'Email this payment request?' }); expect(dialog).toHaveTextContent('jamie@example.test'); expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send payment request email' }));
  expect(await screen.findByRole('status')).toHaveTextContent('prepared but has not been sent');
  expect(state.api.mock.calls[0][0]).toBe(`/api/sale-workspace/${saved.id}/documents/${mutation.request.documentId}/email`);
});

it('keeps email unavailable when platform sending is disabled', () => {
  state.emailEnabled = false; const mutation = withRequest();
  render(<SalePaymentRequests sale={mutation.sale} onSaved={vi.fn()}/>);
  expect(screen.getByRole('button', { name: 'Email PDF' })).toBeDisabled(); expect(state.api).not.toHaveBeenCalled();
});

it('retains the same request identity on an uncertain creation retry', async () => {
  const sale = fixture(); state.api.mockRejectedValue(new Error('Connection lost'));
  render(<SalePaymentRequests sale={sale} onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'New request' })); fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create payment request' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Create payment request' })); await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
  expect(JSON.parse(state.api.mock.calls[0][1].body).requestId).toBe(JSON.parse(state.api.mock.calls[1][1].body).requestId);
});
