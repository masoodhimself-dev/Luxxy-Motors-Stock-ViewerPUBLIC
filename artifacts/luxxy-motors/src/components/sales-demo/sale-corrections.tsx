import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import {
  changeSaleWorkspace, hasSeparateDeliveryInvoice, latestFullSaleInvoice, operationMoney,
  saleInvoiceDeliveryCoverage, saleInvoiceTermsMatch, saleWorkspaceBranding, saleWorkspacePence, saleWorkspaceTotals,
  type SaleWorkspaceCommand, type SaleWorkspaceDocument, type SaleWorkspaceDraft, type SaleWorkspaceMutation, type SaleWorkspaceRecord,
} from '@workspace/vehicle-meta';
import { ChevronRight, Truck, UserRound, WalletCards } from '@/components/icons';
import { usePopupDraftGuard } from '@/components/portal/popup-draft-guard';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, inputClass } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { requestUuid } from '@/lib/request-uuid';
import { saleMoney, todayLondon } from './sales-controls';
import './sale-corrections.css';

export type SaleCorrectionIssue = 'customer' | 'payment' | 'delivery';

type Props = {
  sale: SaleWorkspaceRecord;
  initialIssue?: SaleCorrectionIssue;
  canManageSales: boolean;
  canRecordPayments: boolean;
  canRefundPayments: boolean;
  disabled?: boolean;
  instructions?: string;
  onBusyChange?: (busy: boolean) => void;
  onSaved: (sale: SaleWorkspaceRecord, document?: SaleWorkspaceDocument, next?: 'updated-invoice') => void;
  onClose: () => void;
};
type Contact = Pick<SaleWorkspaceDraft, 'customer' | 'email' | 'phone' | 'address'>;
type CorrectionPlan = {
  path: string;
  method: 'POST' | 'PUT';
  body: Record<string, unknown>;
  saleId: string;
  revision: number;
  before: number;
  balance: number;
  change: string;
  paperwork: string;
  next?: 'updated-invoice';
};

const issues = [
  { id: 'customer', title: 'Wrong customer details', description: 'Correct a name, email, phone number or address.', Icon: UserRound },
  { id: 'payment', title: 'Wrong payment amount', description: 'Check what was received and correct the ledger.', Icon: WalletCards },
  { id: 'delivery', title: 'Change a delivery charge', description: 'See the new charge, balance and paperwork.', Icon: Truck },
] as const;

function inputMoney(pence: number) {
  return `${Math.floor(pence / 100)}.${String(pence % 100).padStart(2, '0')}`;
}

function balanceText(pence: number) {
  if (pence === 0) return 'Settled';
  return `${saleMoney(Math.abs(pence))} ${pence < 0 ? 'customer credit' : 'to pay'}`;
}

function previewChange(sale: SaleWorkspaceRecord, command: SaleWorkspaceCommand) {
  let sequence = 0;
  return changeSaleWorkspace({ ...sale, documentArchives: undefined }, command, {
    expectedRevision: sale.revision, requestId: `correction-preview-${sale.revision}`,
  }, {
    now: new Date().toISOString(), actor: 'Staff review', nextId: () => `review-${++sequence}`,
    nextNumber: () => 'Review only', branding: sale.documents.at(-1)?.snapshot.branding ?? saleWorkspaceBranding({}),
  });
}

export function SaleCorrections({
  sale, initialIssue, canManageSales, canRecordPayments, canRefundPayments, disabled = false,
  instructions, onBusyChange, onSaved, onClose,
}: Props) {
  const id = useId();
  const [issue, setIssue] = useState(initialIssue);
  const [contact, setContact] = useState<Contact>(() => ({
    customer: sale.draft.customer, email: sale.draft.email, phone: sale.draft.phone, address: sale.draft.address,
  }));
  const [paymentId, setPaymentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [deliveryAmount, setDeliveryAmount] = useState(sale.draft.deliveryCharge || '0');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [plan, setPlan] = useState<CorrectionPlan>();
  const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ key: string; id: string } | undefined>(undefined);
  const saving = useRef(false);
  const mounted = useRef(false);
  const latest = useRef({ id: sale.id, revision: sale.revision });
  latest.current = { id: sale.id, revision: sale.revision };
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { title.current?.focus({ preventScroll: true }); }, [issue, plan]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const guard = usePopupDraftGuard({ dirty, blocked: () => saving.current, onClose });

  const existingInvoice = [...sale.documents].reverse().find(document => document.type === 'invoice');
  const fullInvoice = latestFullSaleInvoice(sale.documents);
  const canNote = canManageSales && Boolean(existingInvoice || sale.completedAt);
  const closed = Boolean(sale.standaloneReturn || sale.returnReplacement?.direction === 'returned' || ['released', 'returned'].includes(sale.lifecycle?.status ?? ''));
  const contactBlocked = closed || Boolean(sale.completedAt || sale.lifecycle?.status === 'sold') || hasSeparateDeliveryInvoice(sale);
  const providerPaymentIds = new Set(Object.values(sale.providerPayments ?? {}).map(payment => payment.paymentId));
  const payments = sale.payments.filter(payment => payment.status === 'confirmed' && payment.signedAmountPence > 0 &&
    payment.kind !== 'refund-correction' && !providerPaymentIds.has(payment.id) && !payment.paymentRequestId &&
    !sale.payments.some(row => row.reversesPaymentId === payment.id && row.status === 'confirmed'));
  const payment = payments.find(row => row.id === paymentId);
  const priorDelivery = saleWorkspacePence(sale.draft.deliveryCharge ?? '');
  const reducingInvoicedDelivery = Boolean(existingInvoice && deliveryAmount.trim() && saleWorkspacePence(deliveryAmount) < priorDelivery);
  const billedDelivery = fullInvoice ? saleInvoiceDeliveryCoverage(fullInvoice, sale.documents) : null;
  const deliveryPaperworkBlocked = fullInvoice
    ? !billedDelivery || !saleInvoiceTermsMatch(fullInvoice.snapshot.draft, sale.draft)
    : sale.documents.some(document => document.type === 'delivery-invoice');
  const paymentBlocked = closed || !payments.length;
  const handoff = (issue === 'customer' && contactBlocked) || (issue === 'payment' && paymentBlocked && canNote) ||
    (issue === 'delivery' && (closed || reducingInvoicedDelivery || deliveryPaperworkBlocked));
  const balance = saleWorkspaceTotals(sale.draft, sale.payments).balance;
  const workspace = `/api/sale-workspace/${encodeURIComponent(sale.id)}`;
  const page = issues.find(entry => entry.id === issue);
  const permitted = issue === 'payment' ? canRecordPayments || canRefundPayments || (handoff && canNote) : canManageSales;
  const staleReview = plan && (plan.saleId !== sale.id || plan.revision !== sale.revision);

  function edit(action: () => void) {
    action();
    setDirty(true);
    setError('');
  }

  function choose(value?: SaleCorrectionIssue) {
    setIssue(value);
    setError('');
    setReason('');
    setReference('');
    setPlan(undefined);
    setConfirmed(false);
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !permitted || saving.current) return;
    setError('');
    setConfirmed(false);
    try {
      const base = { saleId: sale.id, revision: sale.revision, before: balance, balance, method: 'POST' as const };
      if (handoff) {
        if (!canNote || !reason.trim()) throw new Error('Add what needs to be corrected.');
        const change = issue === 'delivery' && reducingInvoicedDelivery
          ? `Requested delivery charge: ${saleMoney(priorDelivery)} to ${saleMoney(operationMoney(deliveryAmount, 'delivery charge', true))}.`
          : `Review: ${page?.title.toLowerCase()}.`;
        setPlan({ ...base, path: `${workspace}/corrections`, body: { description: `${change}\n${reason.trim()}`, reference: reference.trim() }, change,
          paperwork: 'A note will be saved for your manager or accountant. The sale balance and issued documents stay as they are.' });
        return;
      }
      if (issue === 'customer') {
        const updated = { ...sale.draft, ...Object.fromEntries(Object.entries(contact).map(([field, value]) => [field, value.trim()])) };
        if (!updated.customer.trim()) throw new Error('Enter the customer name.');
        if (Object.keys(contact).every(field => updated[field as keyof Contact] === sale.draft[field as keyof Contact])) throw new Error('Change at least one customer detail.');
        previewChange(sale, { action: 'update', draft: updated });
        setPlan({ ...base, path: workspace, method: 'PUT', body: { draft: updated },
          next: existingInvoice && canRecordPayments && balance >= 0 ? 'updated-invoice' : undefined,
          change: `Save the corrected contact details for ${updated.customer}${updated.email ? ` (${updated.email})` : ''}.`,
          paperwork: existingInvoice ? 'Create an updated invoice after saving. The original PDF stays in the sale history.' : 'New paperwork will use these details. No PDF is created now.' });
        return;
      }
      if (issue === 'payment') {
        if (closed || !payment) throw new Error('Choose a confirmed payment that can be corrected here.');
        if (!paymentAmount.trim()) throw new Error('Enter the amount actually received.');
        const corrected = operationMoney(paymentAmount, 'received amount', true);
        const difference = corrected - payment.amountPence;
        if (!difference) throw new Error('Enter a different amount.');
        if (difference < 0 && !canRefundPayments) throw new Error('Ask a member of staff with payment correction access to reduce this entry.');
        if (difference > 0 && !canRecordPayments) throw new Error('Ask a member of staff with payment access to record the missing amount.');
        const amount = inputMoney(Math.abs(difference));
        const command: SaleWorkspaceCommand = difference < 0
          ? { action: 'reverse', paymentId: payment.id, kind: 'reversal', amount, date: todayLondon(), reason: reason.trim() }
          : { action: 'payment', payment: { amount, method: payment.method, date: payment.date, reference: payment.reference, kind: 'part-payment', status: 'confirmed' } };
        const preview = previewChange(sale, command);
        const path = command.action === 'reverse' ? `${workspace}/payments/${encodeURIComponent(payment.id)}/reverse` : `${workspace}/payments`;
        const body = command.action === 'reverse' ? { amount, date: command.date, reason: command.reason, kind: command.kind } : { payment: command.payment };
        setPlan({ ...base, path, body, balance: saleWorkspaceTotals(preview.sale.draft, preview.sale.payments).balance,
          change: `Change the recorded amount from ${saleMoney(payment.amountPence)} to ${saleMoney(corrected)} by ${difference < 0 ? 'recording a correction of' : 'recording the missing'} ${saleMoney(Math.abs(difference))}.`,
          paperwork: difference < 0 ? 'A payment adjustment PDF will be saved. No money is sent.' : 'A receipt for the additional recorded amount will be saved. No money is charged.' });
        return;
      }
      if (issue === 'delivery') {
        if (!deliveryAmount.trim()) throw new Error('Enter a delivery charge. Use 0 for free delivery.');
        const amount = operationMoney(deliveryAmount, 'delivery charge', true);
        if (amount === priorDelivery) throw new Error('Enter a different delivery charge.');
        if (amount > 0 && sale.draft.fulfilment?.method !== 'delivery') throw new Error('Choose delivery in Collection & delivery before changing its charge.');
        if (sale.draft.adjustments?.some(adjustment => adjustment.kind === 'fee' && /deliver/i.test(adjustment.description))) throw new Error('Review the existing delivery extra before changing the delivery charge.');
        if (billedDelivery && billedDelivery.amount > amount) throw new Error('Review the saved invoices with your manager before changing this delivery charge.');
        const draft = { ...sale.draft, deliveryCharge: inputMoney(amount) };
        const nextBalance = saleWorkspaceTotals(draft, sale.payments).balance;
        if (!Number.isSafeInteger(nextBalance)) throw new Error('Check the delivery charge and saved balance.');
        setPlan({ ...base, path: `/api/sale-operations/${encodeURIComponent(sale.id)}/delivery-charge`, body: { amount: draft.deliveryCharge }, balance: nextBalance,
          change: `Change the delivery charge from ${saleMoney(priorDelivery)} to ${saleMoney(amount)}.`,
          paperwork: billedDelivery && amount > billedDelivery.amount ? `A separate delivery invoice for ${saleMoney(amount - billedDelivery.amount)} will be saved. The vehicle is only charged on the original invoice.` : 'The next sales invoice will use the new charge. No PDF is created now.' });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the correction details.');
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan || !confirmed || disabled || !permitted || saving.current) return;
    if (staleReview) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const key = JSON.stringify(plan);
      if (request.current?.key !== key) request.current = { key, id: requestUuid() };
      const result = await customFetch<SaleWorkspaceMutation>(plan.path, {
        method: plan.method, body: JSON.stringify({ ...plan.body, expectedRevision: plan.revision, requestId: request.current.id }),
      });
      if (!mounted.current) return;
      if (result.sale?.id !== sale.id || latest.current.id !== sale.id || latest.current.revision !== plan.revision) {
        throw new Error('The correction may have been saved. Reload the sale before making another change.');
      }
      onSaved(result.sale, result.document, plan.next);
      onClose();
    } catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof HttpApiError && cause.data && typeof cause.data === 'object' && 'error' in cause.data
        ? String(cause.data.error) : cause instanceof Error ? cause.message : 'The correction could not be saved. Try again.');
    } finally { saving.current = false; if (mounted.current) setBusy(false); }
  }

  const canReview = permitted && !disabled && (handoff ? canNote : issue !== 'payment' || !paymentBlocked);
  const decreasingPayment = payment && paymentAmount.trim() && saleWorkspacePence(paymentAmount) < payment.amountPence;

  return <Dialog open onOpenChange={open => { if (!open) guard.requestClose(); }}>
    <DialogContent className="portal-action-dialog sales-action-dialog sale-correction-dialog z-[90] max-w-xl" overlayClassName="z-[89]" closeDisabled={busy} aria-busy={busy}>
      <DialogHeader>
        <DialogTitle ref={title}>{plan ? 'Review correction' : page?.title ?? 'Correct something'}</DialogTitle>
        <DialogDescription>{plan ? 'Check the balance and paperwork before saving.' : 'Choose what needs correcting. Issued paperwork stays in the sale history.'}</DialogDescription>
      </DialogHeader>
      {guard.discardPrompt}
      {disabled && !busy && <p role="status" className="sale-correction-note">Save or clear your other changes on this sale before correcting it.</p>}
      {!issue && <div className="sale-correction-choices" role="group" aria-label="Correction choices">
        {issues.map(({ id: value, title: label, description, Icon }) => <button key={value} type="button"
          className="sale-correction-choice"
          onClick={() => choose(value)}>
          <Icon size={19} aria-hidden />
          <span><strong>{label}</strong><small>{description}</small></span>
          <ChevronRight size={16} aria-hidden />
        </button>)}
      </div>}
      {issue && !plan && <form className="sale-correction-form" onSubmit={review}>
        {!permitted && <p className="sale-correction-note">Ask a manager or a member of staff with the right payment access to make this correction.</p>}
        {permitted && issue === 'customer' && !contactBlocked && <div className="grid gap-3">
          <label>Customer name<Input required value={contact.customer} maxLength={200} onChange={event => edit(() => setContact({ ...contact, customer: event.target.value }))} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Email address<Input type="email" value={contact.email} maxLength={254} onChange={event => edit(() => setContact({ ...contact, email: event.target.value }))} /></label>
            <label>Phone number<Input type="tel" value={contact.phone} maxLength={80} onChange={event => edit(() => setContact({ ...contact, phone: event.target.value }))} /></label>
          </div>
          <label>Postal address<Textarea rows={2} value={contact.address} maxLength={2000} onChange={event => edit(() => setContact({ ...contact, address: event.target.value }))} /></label>
        </div>}
        {permitted && issue === 'payment' && (paymentBlocked ? <p className="sale-correction-note">No eligible confirmed payments can be corrected here. Check the original request, provider or payment history.</p> : <div className="grid gap-3">
          <label>Payment to correct<select className={`${inputClass} min-h-11 px-3 text-sm`} value={paymentId} required onChange={event => edit(() => {
            setPaymentId(event.target.value);
            const selected = payments.find(row => row.id === event.target.value);
            setPaymentAmount(selected ? inputMoney(selected.amountPence) : '');
          })}>
            <option value="">Choose a payment</option>
            {payments.map(row => <option key={row.id} value={row.id}>{saleMoney(row.amountPence)} · {row.date} · {row.method}{row.reference ? ` · ${row.reference}` : ''}</option>)}
          </select></label>
          {payment && <label>Amount actually received (£)<Input className="tabular-nums" inputMode="decimal" required maxLength={16} value={paymentAmount} onChange={event => edit(() => setPaymentAmount(event.target.value))} /></label>}
          {decreasingPayment && <label>Reason for correcting this entry<Textarea required rows={2} maxLength={1000} value={reason} onChange={event => edit(() => setReason(event.target.value))} /></label>}
        </div>)}
        {permitted && issue === 'delivery' && !closed && <label>Correct delivery charge (£)<Input className="tabular-nums" required inputMode="decimal" maxLength={16} value={deliveryAmount} onChange={event => edit(() => setDeliveryAmount(event.target.value))} /></label>}
        {permitted && handoff && <div className="grid gap-3">
          <div className="sale-correction-guidance">
            <p>This change needs your manager or accountant. You can record what needs correcting and keep the issued documents and current balance as they are.</p>
            {instructions?.trim() && <p>{instructions}</p>}
          </div>
          {canNote && <>
            <label>What needs correcting?<Textarea required rows={3} maxLength={1800} value={reason} onChange={event => edit(() => setReason(event.target.value))} /></label>
            <label>Paperwork reference (optional)<Input maxLength={200} value={reference} onChange={event => edit(() => setReference(event.target.value))} /></label>
          </>}
        </div>}
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => choose()}>Back to choices</Button>
          {canReview && <Button type="submit">Review correction</Button>}
        </DialogFooter>
      </form>}
      {plan && <form className="sale-correction-form" onSubmit={save}>
        <p className="sale-correction-note">{plan.change}</p>
        <dl className="sale-correction-balances">
          <div><dt>Balance before</dt><dd>{balanceText(plan.before)}</dd></div>
          <div data-tone={plan.balance > 0 ? 'due' : undefined}><dt>Balance after</dt><dd>{balanceText(plan.balance)}</dd></div>
        </dl>
        <div className="sale-correction-paperwork"><h3>Paperwork</h3><p>{plan.paperwork}</p>{existingInvoice && <p>Saved invoice {existingInvoice.number} is kept.</p>}</div>
        <label htmlFor={`${id}-confirm`} className="sale-correction-confirm flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input id={`${id}-confirm`} type="checkbox" className="size-5 shrink-0 accent-primary" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />
          {issue === 'payment' ? 'I checked the amount against the payment record.' : 'I have checked this correction.'}
        </label>
        {(error || staleReview) && <p role="alert" className="text-sm font-medium text-destructive">{error || 'This sale changed. Go back and review the correction again.'}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => { setPlan(undefined); setError(''); }}>Back to edit</Button>
          <Button type="submit" disabled={busy || disabled || !confirmed || staleReview}>{busy ? 'Saving…' : 'Save correction'}</Button>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
