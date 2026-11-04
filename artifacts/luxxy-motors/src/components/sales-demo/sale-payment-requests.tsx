import { useEffect, useRef, useState } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { salePaymentRequestAvailable, salePaymentRequestRemaining, saleWorkspacePence, saleWorkspaceTotals, type SalePaymentRequest, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Check, Download, Mail, MessageCircle, Plus, Wallet } from '@/components/icons';
import { customerWhatsAppUrl } from '@/lib/customer-whatsapp';
import { useDealerFeatures } from '@/lib/dealer-features';
import { requestUuid } from '@/lib/request-uuid';
import { saleMoney, todayLondon } from './sales-controls';
import './sale-payment-requests.css';

type OperationResult = { sale: SaleWorkspaceRecord; requestId?: string };
type RequestTask = { signal: AbortSignal; ensureCurrent: () => void };
type SalePaymentRequestsProps = {
  sale: SaleWorkspaceRecord; onSaved: (sale: SaleWorkspaceRecord) => void; actionOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
  onRecordDeposit?: (request: SalePaymentRequest) => void; canReserve?: boolean;
  showMoneySummary?: boolean;
};
const errorText = (error: unknown) => error instanceof HttpApiError && error.data && typeof error.data === 'object' && 'error' in error.data
  ? String(error.data.error) : error instanceof Error ? error.message : 'The request could not be updated. Try again.';
const requestLabel = (request: SalePaymentRequest) => request.kind === 'deposit' ? 'Deposit' : request.kind === 'balance' ? 'Remaining balance' : 'Agreed payment';
function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(date) : value;
}

/** A request is an invitation to pay. Sharing it never records money or reserves stock. */
export function SalePaymentRequests({ sale, onSaved, actionOnly = false, onDirtyChange, onBusyChange, onRecordDeposit, showMoneySummary = true, canReserve = true }: SalePaymentRequestsProps) {
  const features = useDealerFeatures();
  const initialDate = useRef(todayLondon());
  const [formOpen, setFormOpen] = useState(actionOnly && !sale.paymentRequests?.length);
  const [kind, setKind] = useState<'deposit' | 'balance' | 'other'>('deposit');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(initialDate.current);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [whatsappOpened, setWhatsappOpened] = useState<string>();
  const [confirmation, setConfirmation] = useState<{ kind: 'email' | 'whatsapp' | 'cancel'; request: SalePaymentRequest }>();
  const inFlight = useRef(false), retries = useRef(new Map<string, string>());
  const controller = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const currentSaleId = useRef(sale.id); currentSaleId.current = sale.id;
  const savedCallback = useRef(onSaved); savedCallback.current = onSaved;
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  const now = new Date().toISOString();
  const requests = [...(sale.paymentRequests ?? [])].reverse();
  const active = requests.find(request => salePaymentRequestAvailable(sale, request, now) && salePaymentRequestRemaining(sale, request) > 0);
  const current = active ?? requests.find(request => request.status === 'accepted');
  const previous = requests.filter(request => request.id !== current?.id);
  const closed = sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' || sale.returnReplacement?.direction === 'returned';
  useEffect(() => {
    mounted.current = true; generation.current++; inFlight.current = false; setBusy(false);
    initialDate.current = todayLondon();
    setWhatsappOpened(undefined); setConfirmation(undefined); setFormOpen(actionOnly && !sale.paymentRequests?.length); setError(''); setNotice('');
    setKind('deposit'); setAmount(''); setNote(''); setDueDate(initialDate.current); retries.current.clear();
    return () => { mounted.current = false; generation.current++; controller.current?.abort(); };
  }, [sale.id, actionOnly]);
  const dirty = Boolean(amount.trim() || note.trim() || kind !== 'deposit' || dueDate !== initialDate.current);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  const parsedAmount = saleWorkspacePence(amount);
  const requestedAmount = Number.isSafeInteger(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;

  async function operation(action: string, payload: Record<string, unknown>, task: RequestTask) {
    const body = { expectedRevision: sale.revision, ...payload }, fingerprint = JSON.stringify([sale.id, action, body]);
    const requestId = retries.current.get(fingerprint) ?? requestUuid(); retries.current.set(fingerprint, requestId);
    const result = await customFetch<OperationResult>(`/api/sale-operations/${encodeURIComponent(sale.id)}/${action}`, { method: 'POST', body: JSON.stringify({ ...body, requestId }), signal: task.signal });
    task.ensureCurrent();
    if (!result.sale || result.sale.id !== sale.id) throw new Error('The saved deal could not be confirmed. Reload it before retrying.');
    retries.current.delete(fingerprint); savedCallback.current(result.sale); task.ensureCurrent();
    return result;
  }
  async function run(task: (request: RequestTask) => Promise<void>) {
    if (inFlight.current) return;
    const selectedSale = sale.id, attempt = ++generation.current, request = new AbortController(); controller.current = request;
    const isCurrent = () => mounted.current && generation.current === attempt && currentSaleId.current === selectedSale && !request.signal.aborted;
    const ensureCurrent = () => { if (!isCurrent()) throw new DOMException('The selected sale changed.', 'AbortError'); };
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try { await task({ signal: request.signal, ensureCurrent }); } catch (cause) { if (isCurrent()) setError(errorText(cause)); }
    finally { if (isCurrent()) { inFlight.current = false; setBusy(false); } }
  }
  async function download(request: SalePaymentRequest, task: RequestTask) {
    const blob = await customFetch<Blob>(`/api/sale-workspace/${encodeURIComponent(sale.id)}/documents/${encodeURIComponent(request.documentId)}/pdf`, { responseType: 'blob', signal: task.signal });
    task.ensureCurrent();
    if (!(blob instanceof Blob) || !blob.size || blob.type && !/application\/pdf/.test(blob.type)) throw new Error('The PDF could not be downloaded. Try again.');
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${request.reference.replace(/[^a-z0-9_-]/gi, '') || 'payment-request'}.pdf`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setNotice('Payment request PDF downloaded.');
  }
  async function confirmAction() {
    if (!confirmation) return;
    const selected = confirmation;
    await run(async task => {
      if (selected.kind === 'email') {
        if (!features.enabled('customerEmails')) throw new Error('Customer email sending is not available. Download the PDF to share it yourself.');
        const emailKey = JSON.stringify(['email', sale.id, sale.revision, selected.request.documentId]);
        const requestId = retries.current.get(emailKey) ?? requestUuid(); retries.current.set(emailKey, requestId);
        const result = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${encodeURIComponent(sale.id)}/documents/${encodeURIComponent(selected.request.documentId)}/email`, { method: 'POST', body: JSON.stringify({ requestId, expectedRevision: sale.revision }), signal: task.signal });
        task.ensureCurrent();
        if (!result.sale || result.sale.id !== sale.id) throw new Error('The email status could not be confirmed. Check the saved email history before retrying.');
        savedCallback.current(result.sale); task.ensureCurrent();
        retries.current.delete(emailKey);
        const delivery = result.sale.emailDeliveries?.filter(row => row.documentId === selected.request.documentId).at(-1);
        if (delivery?.status === 'sent') setNotice(`Payment request emailed to ${delivery.to}.`);
        else if (delivery?.status === 'prepared') setNotice('The email was prepared but has not been sent. Check dealership email settings.');
        else throw new Error(delivery?.error || 'The email send could not be confirmed. Check its delivery status before retrying.');
      } else if (selected.kind === 'whatsapp') {
        await operation('mark-request-shared', { paymentRequestId: selected.request.id, channel: 'whatsapp', acknowledge: true }, task);
        setNotice('WhatsApp marked as sent. Payment still needs to be checked.'); setWhatsappOpened(undefined);
      } else {
        await operation('cancel-request', { paymentRequestId: selected.request.id }, task);
        setFormOpen(actionOnly); setNotice('Payment request cancelled. No money or stock status changed.');
      }
      setConfirmation(undefined);
    });
  }
  function requestRow(request: SalePaymentRequest, history = false) {
    const available = salePaymentRequestAvailable(sale, request, now), remaining = salePaymentRequestRemaining(sale, request);
    const deliveries = sale.emailDeliveries?.filter(row => row.documentId === request.documentId) ?? [];
    const sent = [...deliveries].reverse().find(row => row.status === 'sent');
    const latest = deliveries.at(-1);
    const shared = Boolean(sent || request.sharedAt);
    const accepted = request.status === 'accepted';
    const settled = remaining === 0 && request.status !== 'cancelled';
    const status = accepted ? 'Deposit accepted' : request.status === 'cancelled' ? 'Cancelled' : settled ? 'Paid' : !available ? 'No longer current' : request.paymentReportedAt ? 'Payment to check' : shared ? 'Waiting for payment' : 'Ready to send';
    const canShare = available && remaining > 0;
    const overdue = canShare && request.dueDate < todayLondon();
    const message = `Hi ${sale.draft.customer}, thank you for choosing the ${sale.draft.vehicle} (${sale.draft.registration}). The vehicle price is ${saleMoney(totals.price)}. Your ${request.kind === 'deposit' ? 'deposit' : 'payment'} request is ${saleMoney(request.amountPence)}.${remaining !== request.amountPence ? ` There is ${saleMoney(remaining)} still to pay on this request.` : ''} Please see the PDF for our bank details and payment reference. We will confirm once the payment has arrived.`;
    const whatsapp = customerWhatsAppUrl(sale.draft.phone, message);
    return <article key={request.id} className={`sale-request-row${history ? ' sale-request-row-history' : ''}`} aria-label={`${requestLabel(request)} request ${request.reference}`}>
      <div className="sale-request-row-heading"><div><h3>{requestLabel(request)} request <span>{saleMoney(request.amountPence)}</span></h3><small>{request.reference} · Pay by {dateLabel(request.dueDate)}</small></div><span data-status={accepted || settled ? 'paid' : !available ? 'closed' : 'waiting'}>{status}</span></div>
      {accepted && <p className="sale-request-accepted"><Check size={18} aria-hidden="true"/><span><strong>{saleMoney(request.acceptedAmountPence ?? request.amountPence)} accepted as the deposit.</strong>{typeof request.acceptedAmountPence === 'number' && request.acceptedAmountPence < request.amountPence && <> This is {saleMoney(request.amountPence - request.acceptedAmountPence)} less than requested. The difference is still included in the balance to pay.</>}</span></p>}
      {available && remaining > 0 && remaining !== request.amountPence && <p>Still to pay: <strong>{saleMoney(remaining)}</strong></p>}
      {request.paymentReportedAt && !accepted && !settled && <p className="sale-request-reported">Customer says they have paid. Check the funds before recording payment.</p>}
      {overdue && <p className="sale-request-reported">The payment date has passed. Send a reminder or cancel this request. The car will not be released automatically.</p>}
      {sent && <p className="sale-request-share-status"><Mail size={16} aria-hidden="true"/>Emailed to {sent.to}</p>}
      {request.sharedAt && <p className="sale-request-share-status"><MessageCircle size={16} aria-hidden="true"/>WhatsApp marked as sent</p>}
      {latest && latest.status !== 'sent' && <p className="sale-request-share-status" data-state={latest.status}>{latest.status === 'prepared' ? 'Email prepared — not sent' : latest.status === 'failed' ? 'Email not sent. You can retry the same request.' : latest.status === 'sending' ? 'Email is sending. Check its status before sending again.' : 'Email delivery is unconfirmed. Check the email history before retrying.'}</p>}
      {!history && canShare && (shared || request.paymentReportedAt) && onRecordDeposit && <div className="sale-request-next"><div><h3>Has the {request.kind === 'deposit' ? 'deposit' : 'payment'} arrived?</h3><p>Check your bank or payment record, then confirm the amount received.</p></div><Button disabled={busy || dirty || (request.kind === 'deposit' && !canReserve)} title={request.kind === 'deposit' && !canReserve ? 'Ask a manager to record the deposit and reserve the car.' : undefined} onClick={() => onRecordDeposit(request)}><Wallet size={19} aria-hidden="true"/>{request.kind === 'deposit' ? 'Record deposit' : 'Record payment'}</Button></div>}
      <div className="sale-request-actions">
        {!history && canShare && <Button variant={shared ? 'outline' : 'default'} disabled={busy || !features.enabled('customerEmails') || !sale.draft.email || latest?.status === 'sending' || latest?.status === 'unknown'} title={!features.enabled('customerEmails') ? 'Customer email sending is unavailable.' : !sale.draft.email ? 'Add the customer email address first.' : undefined} onClick={() => { setError(''); setConfirmation({ kind: 'email', request }); }}><Mail size={18} aria-hidden="true"/>{overdue || sent ? 'Email reminder' : latest?.status === 'failed' ? 'Retry email' : 'Email PDF'}</Button>}
        <Button variant="outline" disabled={busy} onClick={() => void run(task => download(request, task))}><Download size={18} aria-hidden="true"/>Download PDF</Button>
        {!history && canShare && whatsapp && <Button asChild variant="outline" disabled={busy}><a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => { setWhatsappOpened(request.id); setNotice('Download the PDF and attach it in WhatsApp. After sending, mark it as sent here.'); }}><MessageCircle size={18} aria-hidden="true"/>Open WhatsApp</a></Button>}
      </div>
      {!history && canShare && <>
        {!whatsapp && <p className="sale-request-help">Add a valid mobile number to use WhatsApp.</p>}
        {whatsappOpened === request.id && <div className="sale-request-whatsapp"><p><strong>Attach the downloaded PDF in WhatsApp.</strong> Opening WhatsApp does not send the request.</p><Button variant="outline" disabled={busy} onClick={() => { setError(''); setConfirmation({ kind: 'whatsapp', request }); }}><Check size={18} aria-hidden="true"/>Mark WhatsApp as sent</Button></div>}
        <details className="sale-request-more"><summary>More options</summary><Button variant="ghost" disabled={busy} onClick={() => { setError(''); setConfirmation({ kind: 'cancel', request }); }}>Cancel request</Button></details>
      </>}
    </article>;
  }
  return <section className={`sale-desk-sheet sale-payment-requests${actionOnly ? ' sale-request-action' : ''}`} aria-label="Payment requests" aria-busy={busy}>
    <div className="sale-request-main">
      <div className="sale-desk-inline-heading"><div><h2><Wallet size={22} aria-hidden="true"/>Request a payment</h2><p>Choose the amount, then send the PDF.</p></div>
        {!closed && !active && totals.balance > 0 && !formOpen && <Button disabled={busy} onClick={() => { setFormOpen(true); setError(''); }}><Plus size={18} aria-hidden="true"/>New request</Button>}
      </div>
      {showMoneySummary && <dl className="sale-request-money"><div><dt>Vehicle price</dt><dd>{saleMoney(totals.price)}</dd></div><div data-money="paid"><dt>Paid</dt><dd>{saleMoney(totals.confirmedPaid)}</dd></div><div data-money={totals.balance > 0 ? 'due' : 'paid'}><dt>{totals.balance < 0 ? 'Customer credit' : 'Left to pay'}</dt><dd>{saleMoney(Math.abs(totals.balance))}</dd></div></dl>}
      {error && <p className="invoice-error" role="alert">{error}</p>}
      {notice && <p className="invoice-message" role="status">{notice}</p>}
      {closed ? <p>This deal is closed. Open the current deal to request a payment.</p> : totals.balance <= 0 ? <p>No payment is due on this deal.</p> : !requests.length && !formOpen ? <p className="sale-desk-empty-inline">No payment requested yet.</p> : null}
      {formOpen && !closed && !active && totals.balance > 0 && <form onSubmit={event => { event.preventDefault(); void run(async task => { await operation('request-payment', { kind, amount, dueDate, note }, task); setFormOpen(false); setKind('deposit'); setAmount(''); setNote(''); setDueDate(initialDate.current); setNotice('Payment request saved. Choose how to send it.'); }); }}>
        <fieldset disabled={busy}><div className="sale-request-fields">
          <label>Request type<select value={kind} onChange={event => { const next = event.target.value as typeof kind; setKind(next); if (next === 'balance') setAmount((totals.balance / 100).toFixed(2)); }}><option value="deposit">Deposit</option><option value="balance">Remaining balance</option><option value="other">Other agreed amount</option></select></label>
          <label>Amount (£)<Input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="For example, 500.00"/><div className="sales-flow-amounts">{[10000,25000,50000].filter(value => value <= totals.balance).map(value => <button type="button" key={value} onClick={() => setAmount((value/100).toFixed(2))}>{saleMoney(value)}</button>)}</div></label>
          <label>Pay by<Input required type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}/></label>
        </div><details className="sales-flow-optional"><summary>Add a note (optional)</summary><label>For the customer<Textarea rows={2} value={note} maxLength={1200} onChange={event => setNote(event.target.value)} placeholder="Only include what you have agreed with the customer."/></label></details>
          <p className="sale-request-help">Creating a request does not record a payment or change the car’s stock status.</p>
          {amount.trim() && !Number.isSafeInteger(parsedAmount) && <p role="alert">Enter pounds and pence, for example 250.00.</p>}
          {requestedAmount > totals.balance && <p role="alert">The request is more than the balance left to pay.</p>}
          <Button type="submit" disabled={busy || requestedAmount <= 0 || requestedAmount > totals.balance || !dueDate}>{busy ? 'Saving request…' : `Request ${requestedAmount > 0 ? saleMoney(requestedAmount) : 'payment'}`}</Button>
        </fieldset>
      </form>}
      {current && requestRow(current)}
      {previous.length > 0 && <details className="sale-request-history"><summary>Previous requests ({previous.length})</summary><div>{previous.map(request => requestRow(request, true))}</div></details>}
    </div>
    {confirmation && <Dialog open onOpenChange={open => { if (!open && !busy) setConfirmation(undefined); }}><DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy}>
      <DialogHeader><DialogTitle>{confirmation.kind === 'email' ? 'Email this payment request?' : confirmation.kind === 'whatsapp' ? 'Have you sent the request?' : 'Cancel this payment request?'}</DialogTitle><DialogDescription>{confirmation.kind === 'email' ? `Send the saved payment request PDF to ${sale.draft.email}. This asks for payment and does not confirm a receipt.` : confirmation.kind === 'whatsapp' ? 'Confirm that you sent the message and attached the payment request PDF in WhatsApp. This does not record a payment or reserve the car.' : 'Keep this request in the history. Recorded payments, invoices and the car’s stock status will stay the same.'}</DialogDescription></DialogHeader>
      <p>{confirmation.request.reference} · {saleMoney(confirmation.request.amountPence)} · {sale.draft.vehicle}</p>{error && <p role="alert" className="invoice-error">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmation(undefined)}>Go back</Button><Button disabled={busy} onClick={() => void confirmAction()}>{busy ? 'Working…' : confirmation.kind === 'email' ? 'Send payment request email' : confirmation.kind === 'whatsapp' ? 'Yes, mark as sent' : 'Cancel payment request'}</Button></DialogFooter>
    </DialogContent></Dialog>}
  </section>;
}
