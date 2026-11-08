import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { changeSaleWorkspace, createSaleWorkspace, markDepositConfirmationShared, type SaleWorkspaceContext } from '@workspace/vehicle-meta';
import { MarkDepositConfirmationShared } from './mark-deposit-confirmation-shared';

const api = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch: api, HttpApiError: class extends Error {} }));

it('only records a manual share after staff confirm they shared the exact saved receipt', async () => {
  let serial = 0;
  const context: SaleWorkspaceContext = {
    now: '2026-11-08T12:00:00.000Z', actor: 'Fixture staff', nextId: () => `fixture-${++serial}`,
    nextNumber: type => `${type}-${++serial}`,
    branding: {
      identity: { name: 'Fictional Motors', logoText: '', logoAsset: '' },
      contact: { phone: '', email: '' },
      address: { street: '', city: '', region: '', postcode: '' },
      legal: { companyName: '', companyNumber: '', vatNumber: '' },
    },
  };
  const original = createSaleWorkspace({
    requestId: 'create-sale', draft: { customer: 'Fictional Buyer', vehicleId: 'car-1', vehicle: 'Ford Focus', registration: 'AB20 XYZ', price: '10000' },
  }, context, 'SALE-42').sale;
  const received = changeSaleWorkspace(original, {
    action: 'take-deposit',
    payment: { kind: 'deposit', status: 'confirmed', method: 'Bank transfer', amount: '500', date: '2026-11-08', reference: '' },
  }, { requestId: 'take-deposit', expectedRevision: original.revision }, context);
  const document = received.document!, shared = structuredClone(received.sale), onSaved = vi.fn();
  markDepositConfirmationShared(shared, { documentId: document.id, acknowledge: true }, context);
  api.mockResolvedValueOnce({ sale: shared });
  const view = render(<MarkDepositConfirmationShared sale={received.sale} document={document} onSaved={onSaved}/>);

  fireEvent.click(screen.getByRole('button', { name: 'Mark receipt as shared' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent(document.number);
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Yes, mark as shared' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(shared));
  expect(api).toHaveBeenCalledOnce();
  expect(api.mock.calls[0][0]).toBe(`/api/sale-operations/${received.sale.id}/mark-deposit-confirmation-shared`);
  expect(JSON.parse(api.mock.calls[0][1].body)).toMatchObject({ documentId: document.id, acknowledge: true, expectedRevision: received.sale.revision, requestId: expect.any(String) });
  view.rerender(<MarkDepositConfirmationShared sale={shared} document={document} onSaved={onSaved}/>);
  expect(screen.queryByRole('button', { name: 'Mark receipt as shared' })).not.toBeInTheDocument();
});
