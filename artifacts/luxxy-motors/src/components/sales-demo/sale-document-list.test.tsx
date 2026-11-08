import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { SaleWorkspaceDocument } from '@workspace/vehicle-meta';
import { SaleDocumentList } from './sale-document-list';

function savedDocument(document: Partial<SaleWorkspaceDocument>) {
  return {
    type: 'invoice',
    invoiceKind: 'full',
    issuedAt: '2026-10-25T10:00:00Z',
    snapshot: { totals: { totalDue: 1_000_000 } },
    ...document,
  } as SaleWorkspaceDocument;
}

it('puts linked delivery increments next to the vehicle invoice and opens their original files separately', () => {
  const vehicle = savedDocument({ id: 'vehicle', number: 'INV-1', title: 'Sales invoice' });
  const delivery = savedDocument({
    id: 'delivery', number: 'DLV-1', type: 'delivery-invoice', title: 'Delivery invoice',
    transaction: { kind: 'delivery-invoice', amountPence: 20_000, saleReference: 'SALE-1', invoiceReferences: ['INV-1'], previousDeliveryPence: 0, totalDeliveryPence: 20_000, deliveryAddress: 'Test address' },
  });
  const historic = savedDocument({ id: 'historic', number: 'INV-0', title: 'Deposit invoice', invoiceKind: 'deposit' });
  const onOpen = vi.fn();
  render(<SaleDocumentList documents={[historic, vehicle, delivery]} disabled={false} onOpen={onOpen} />);
  const group = screen.getByRole('region', { name: 'Vehicle invoice and additional delivery charges' });
  expect(within(group).getByText('£10,000.00')).toBeVisible();
  expect(within(group).getByText('£200.00')).toBeVisible();
  expect(within(group).queryByText('Deposit invoice')).not.toBeInTheDocument();
  const [openVehicle, openDelivery] = within(group).getAllByRole('button', { name: 'View & share' });
  fireEvent.click(openVehicle);
  fireEvent.click(openDelivery);
  expect(onOpen.mock.calls).toEqual([[vehicle], [delivery]]);
});
