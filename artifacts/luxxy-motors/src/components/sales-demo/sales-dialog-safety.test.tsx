import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SaleWorkspacePayment } from '@workspace/vehicle-meta';
import { emptyDraft } from './model';
import { CompleteSaleDialog } from './complete-sale-dialog';
import { HandoverDialog, PaymentDialog, ReversePaymentDialog, todayLondon } from './sales-controls';

const draft = { ...emptyDraft(), customer: 'Alex Carter', vehicle: 'Ford Focus' };
const payment: SaleWorkspacePayment = {
  id: 'fixture-payment', amount: '500', amountPence: 50000, signedAmountPence: 50000,
  method: 'Bank transfer', date: '2026-01-01', reference: '', kind: 'deposit',
  status: 'confirmed', recordedBy: 'Fixture staff', recordedAt: '2026-01-01T12:00:00Z',
};

describe('sales popup safety', () => {
  it('keeps entered payment details until the user explicitly discards them', () => {
    const onClose = vi.fn();
    render(<PaymentDialog balance={50000} hasPayments={false} busy={false} problem="" onSave={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Payment amount (£)'), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Discard your changes?');
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Payment amount (£)')).toHaveValue('100');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('guards handover submission even when a form is submitted directly', () => {
    const onSave = vi.fn();
    render(<HandoverDialog draft={draft} balance={10000} busy={false} problem="" onClose={vi.fn()} onSave={onSave} />);
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.submit(form);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText(/I acknowledge the outstanding balance/));
    fireEvent.change(screen.getByLabelText('Received by'), { target: { value: '   ' } });
    fireEvent.submit(form);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Received by'), { target: { value: 'Alex Carter' } });
    fireEvent.submit(form);
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Alex Carter', true);
  });

  it('prevents closing or submitting a handover while it is saving', () => {
    const onSave = vi.fn(), onClose = vi.fn();
    render(<HandoverDialog draft={draft} balance={0} busy problem="" onClose={onClose} onSave={onSave} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByLabelText('Received by')).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('explains an out-of-range refund amount and a date before the original payment', () => {
    const onSave = vi.fn();
    render(<ReversePaymentDialog payment={payment} availablePence={50000} busy={false} problem="" onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Fixture correction' } });
    fireEvent.click(screen.getByLabelText(/I confirm the money has already been refunded/));
    fireEvent.change(screen.getByLabelText('Refund / correction amount (£)'), { target: { value: '500.01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('exceeds the payment');
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Refund / correction amount (£)'), { target: { value: '500' } });
    expect(screen.getByLabelText('Refund date')).toHaveAttribute('min', payment.date);
    fireEvent.change(screen.getByLabelText('Refund date'), { target: { value: '2025-12-31' } });
    expect(screen.getByRole('alert')).toHaveTextContent('on or after the original payment');
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Refund date'), { target: { value: todayLondon() } });
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('keeps an existing pending payment locked while confirmation is saving', () => {
    const onSave = vi.fn(), onClose = vi.fn();
    render(<PaymentDialog balance={50000} hasPayments busy problem="" pending={{ ...payment, status: 'pending' }} onSave={onSave} onClose={onClose} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks the reviewed-sale acknowledgment while the invoice pack is being created', () => {
    const onComplete = vi.fn(), onClose = vi.fn();
    const props = { draft, total: 50000, balance: 0, terms: 'Fixture approved terms', problem: '', onComplete, onClose };
    const { rerender } = render(<CompleteSaleDialog {...props} busy={false} />);
    fireEvent.click(screen.getByRole('checkbox'));
    rerender(<CompleteSaleDialog {...props} busy />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Completing…' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onComplete).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
