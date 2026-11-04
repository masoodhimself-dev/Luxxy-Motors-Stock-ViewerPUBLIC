import { useState } from 'react';
import { salePaymentRequestRemaining, type SaleWorkspacePayment, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { saleMoney, todayLondon } from './sales-controls';
import './sales-dialogs.css';

export type ConfirmSavedPaymentInput = {
  date: string;
  reserveVehicle: boolean;
  reserveConfirmed: boolean;
  acceptShortfall: boolean;
};

export function ConfirmSavedPayment({ sale, payment, busy, problem, onClose, onConfirm }: {
  sale: SaleWorkspaceRecord;
  payment: SaleWorkspacePayment;
  busy: boolean;
  problem: string;
  onClose: () => void;
  onConfirm: (input: ConfirmSavedPaymentInput) => void;
}) {
  const [date, setDate] = useState(todayLondon);
  const [received, setReceived] = useState(false);
  const [acceptShortfall, setAcceptShortfall] = useState(false);
  const deposit = payment.kind === 'deposit';
  const request = sale.paymentRequests?.find(row => row.id === payment.paymentRequestId);
  const requested = request?.kind === 'deposit' ? salePaymentRequestRemaining(sale, request) : 0;
  const shortfall = Math.max(0, requested - payment.amountPence);
  const parsedDate = new Date(`${date}T12:00:00Z`);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === date && date <= todayLondon();
  const valid = payment.status === 'pending' && Number.isSafeInteger(payment.amountPence) && payment.amountPence > 0 && validDate && received && (shortfall === 0 || acceptShortfall);
  const close = () => { if (!busy) onClose(); };

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy} aria-busy={busy} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{deposit ? 'Confirm deposit received' : 'Confirm payment received'}</DialogTitle>
        <DialogDescription>Check the money has arrived before confirming. We’ll save a receipt for this payment.</DialogDescription>
      </DialogHeader>
      <form onSubmit={event => { event.preventDefault(); if (!busy && valid) onConfirm({ date, reserveVehicle: deposit, reserveConfirmed: deposit && received, acceptShortfall: shortfall > 0 && acceptShortfall }); }}>
        <fieldset className="sales-dialog-fields" disabled={busy}>
          <div className="sales-dialog-balance"><span>{payment.method}{payment.reference && ` · ${payment.reference}`}</span><strong>{saleMoney(payment.amountPence)}</strong></div>
          <p className="invoice-note">If a different amount arrived, go back, cancel this pending payment and record the correct amount.</p>
          <label>Date received<Input type="date" value={date} max={todayLondon()} onChange={event => { setDate(event.target.value); setReceived(false); }}/></label>
          {!validDate && <p className="invoice-error" role="alert">Choose a valid date on or before today.</p>}
          {shortfall > 0 && <div className="invoice-message" data-tone="warning">
            <p>{saleMoney(payment.amountPence)} is {saleMoney(shortfall)} less than the {saleMoney(requested)} requested. The unpaid amount stays in the balance.</p>
            <label className="invoice-check"><input type="checkbox" checked={acceptShortfall} onChange={event => setAcceptShortfall(event.target.checked)}/>Accept {saleMoney(payment.amountPence)} as the deposit.</label>
          </div>}
          <label className="invoice-check"><input type="checkbox" checked={received} onChange={event => setReceived(event.target.checked)}/>{deposit ? `I confirm ${saleMoney(payment.amountPence)} has arrived. This will reserve the car and remove it from available stock.` : `I confirm ${saleMoney(payment.amountPence)} has arrived.`}</label>
        </fieldset>
        {problem && <p className="invoice-error" role="alert">{problem}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Go back</Button><Button type="submit" disabled={busy || !valid}>{busy ? 'Confirming…' : deposit ? 'Confirm deposit & reserve car' : 'Confirm payment'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
