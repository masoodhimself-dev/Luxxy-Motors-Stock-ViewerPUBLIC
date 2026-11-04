import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createSaleWorkspace, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { SaleDeliveryCharge } from './sale-delivery-charge';

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => mocks.api(...args), HttpApiError: class extends Error {} }));
function fixture(id = 'sale-a'): SaleWorkspaceRecord {
  const sale = createSaleWorkspace({ requestId: `start-${id}`, draft: { customer: 'Test Buyer', vehicle: 'Ford Focus', price: '10000' } }, {
    now: '2026-11-04T12:00:00Z', actor: 'Staff', nextId: () => id, nextNumber: () => 'TEST-1',
    branding: { identity: { name: 'Test Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } },
  }, 'SALE-1').sale;
  sale.id = id;
  return sale;
}
function start() {
  fireEvent.change(screen.getByLabelText('Delivery charge (£)'), { target: { value: '125' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save delivery charge' }));
}
beforeEach(() => { mocks.api.mockReset(); });

it('locks navigation through the busy callback and applies a successful exact charge once', async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  const sale = fixture(), saved = { ...sale, revision: sale.revision + 1 }, onSaved = vi.fn(), onBusyChange = vi.fn();
  render(<SaleDeliveryCharge sale={sale} onSaved={onSaved} onBusyChange={onBusyChange} />);
  start();
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
  expect(screen.getByRole('button', { name: 'Saving charge…' })).toBeDisabled();
  expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toMatchObject({ amount: '125', expectedRevision: sale.revision });
  await act(async () => resolve({ sale: saved }));
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

it('releases parent busy and never applies a charge response after unmount', async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  const sale = fixture(), onSaved = vi.fn(), onBusyChange = vi.fn();
  const view = render(<SaleDeliveryCharge sale={sale} onSaved={onSaved} onBusyChange={onBusyChange} />);
  start();
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(true));
  view.unmount();
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  await act(async () => resolve({ sale }));
  expect(onSaved).not.toHaveBeenCalled();
});

it('does not replace sale B with a late delivery charge response from sale A', async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  const a = fixture(), b = fixture('sale-b'), onSaved = vi.fn(), onBusyChange = vi.fn();
  const view = render(<SaleDeliveryCharge sale={a} onSaved={onSaved} onBusyChange={onBusyChange} />);
  start();
  view.rerender(<SaleDeliveryCharge sale={b} onSaved={onSaved} onBusyChange={onBusyChange} />);
  expect(screen.getByLabelText('Delivery charge (£)')).toHaveValue('0');
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  await act(async () => resolve({ sale: { ...a, revision: a.revision + 1 } }));
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('keeps a newer same-sale revision and explains that the charge may already be saved', async () => {
  let resolve!: (value: unknown) => void;
  mocks.api.mockImplementation(() => new Promise(r => { resolve = r; }));
  const sale = fixture(), onSaved = vi.fn();
  const view = render(<SaleDeliveryCharge sale={sale} onSaved={onSaved} />);
  start();
  view.rerender(<SaleDeliveryCharge sale={{ ...sale, revision: sale.revision + 2 }} onSaved={onSaved} />);
  await act(async () => resolve({ sale: { ...sale, revision: sale.revision + 1 } }));
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('delivery charge was saved');
});
