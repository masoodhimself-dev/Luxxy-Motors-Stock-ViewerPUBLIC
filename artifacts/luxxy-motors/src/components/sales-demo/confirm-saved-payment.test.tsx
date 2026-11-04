import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { changeSaleWorkspace, createSaleWorkspace, requestSalePayment, type SaleWorkspaceContext } from '@workspace/vehicle-meta';
import { ConfirmSavedPayment } from './confirm-saved-payment';
import { todayLondon } from './sales-controls';

function fixture(amount = '500', kind: 'deposit' | 'part-payment' = 'deposit', withRequest = false) {
  let sequence = 0;
  const context: SaleWorkspaceContext = { now: `${todayLondon()}T12:00:00Z`, actor: 'Test staff', nextId: () => `fixture-${++sequence}`, nextNumber: type => `${type}-${++sequence}`, branding: { identity: { name: 'Example Motors', logoText: 'EXAMPLE', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } } };
  let sale = createSaleWorkspace({ requestId: 'new-sale', draft: { customer: 'Test Buyer', vehicleId: 'car-1', vehicle: 'Ford Focus', price: '8000' } }, context, 'SALE-1').sale;
  if (withRequest) {
    sale = requestSalePayment(sale, { kind: 'deposit', amount: '500', dueDate: todayLondon(), note: '', tokenHash: 'test-only', expiresAt: '2099-01-01T00:00:00Z' }, context).sale;
    sale.paymentRequests![0].deliveryMode = 'document';
  }
  sale = changeSaleWorkspace(sale, { action: 'payment', payment: { amount, kind, status: 'pending', method: 'Bank transfer', date: todayLondon(), reference: 'TEST', ...(withRequest ? { paymentRequestId: sale.paymentRequests![0].id } : {}) } }, { requestId: 'pending-payment', expectedRevision: sale.revision }, context).sale;
  return { sale, payment: sale.payments[0], busy: false, problem: '', onClose: vi.fn(), onConfirm: vi.fn() };
}

describe('confirming a saved pending payment', () => {
  it('keeps the saved amount immutable and requires receipt and reservation confirmation', () => {
    const props = fixture();
    render(<ConfirmSavedPayment {...props}/>);
    expect(screen.queryByLabelText('Payment amount (£)')).not.toBeInTheDocument();
    expect(screen.getByText(/cancel this pending payment/)).toBeInTheDocument();
    expect(screen.getByLabelText('Date received')).toHaveValue(todayLondon());
    expect(screen.getByLabelText('Date received')).toHaveAttribute('max', todayLondon());
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/I confirm £500.00 has arrived/));
    expect(screen.getByLabelText(/remove it from available stock/)).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit & reserve car' }));
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith({ date: todayLondon(), reserveVehicle: true, reserveConfirmed: true, acceptShortfall: false });
    expect(props.payment.status).toBe('pending');
  });

  it('requires separate acceptance when £400 arrives against a £500 request', () => {
    const props = fixture('400', 'deposit', true);
    render(<ConfirmSavedPayment {...props}/>);
    expect(screen.getByText(/£100.00 less than the £500.00 requested/)).toHaveTextContent('unpaid amount stays in the balance');
    fireEvent.click(screen.getByLabelText(/I confirm £400.00 has arrived/));
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Accept £400.00 as the deposit.'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm deposit & reserve car' }));
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith({ date: todayLondon(), reserveVehicle: true, reserveConfirmed: true, acceptShortfall: true });
  });

  it('rejects future dates and confirms further payments without reserving again', () => {
    const props = fixture('250', 'part-payment');
    render(<ConfirmSavedPayment {...props}/>);
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: '2099-01-01' } });
    fireEvent.click(screen.getByLabelText(/I confirm £250.00 has arrived/));
    expect(screen.getByRole('alert')).toHaveTextContent('on or before today');
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(props.onConfirm).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Date received'), { target: { value: todayLondon() } });
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm payment' }));
    expect(props.onConfirm).toHaveBeenCalledExactlyOnceWith({ date: todayLondon(), reserveVehicle: false, reserveConfirmed: false, acceptShortfall: false });
  });

  it('blocks repeat submission and dismissal while saving and displays server errors', () => {
    const props = fixture();
    const { rerender } = render(<ConfirmSavedPayment {...props}/>);
    fireEvent.click(screen.getByRole('checkbox'));
    rerender(<ConfirmSavedPayment {...props} busy problem="The sale changed. Please reload."/>);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Go back' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('The sale changed');
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });
});
