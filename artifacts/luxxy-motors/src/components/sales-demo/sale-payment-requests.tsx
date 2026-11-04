import { useEffect, useRef, useState } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { saleCalculationFigures, salePaymentRequestAvailable, salePaymentRequestRemaining, saleWorkspacePence, saleWorkspaceTotals, type SalePaymentRequest, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Copy, Download, Mail, Plus, RefreshCw, Wallet } from '@/components/icons';
import { customerWhatsAppUrl } from '@/lib/customer-whatsapp';
import { useDealerFeatures } from '@/lib/dealer-features';
import { requestUuid } from '@/lib/request-uuid';
import { saleMoney, todayLondon } from './sales-controls';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { buildDraftSaleDocument, LiveSalesDocument } from './sales-document';
import { CalculationCheck, useSaleCalculationCheck } from './calculation-check';
import './sale-payment-requests.css';

type OperationResult = { sale: SaleWorkspaceRecord; url?: string; requestId?: string };
type RequestTask = { signal: AbortSignal; ensureCurrent: () => void };
type SalePaymentRequestsProps = {
  sale: SaleWorkspaceRecord; onSaved: (sale: SaleWorkspaceRecord) => void; actionOnly?: boolean;
  onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void;
};
const errorText = (error: unknown) => error instanceof HttpApiError && error.data && typeof error.data === 'object' && 'error' in error.data
  ? String(error.data.error) : error instanceof Error ? error.message : 'The request could not be updated. Try again.';
function paymentUrl(value?: string) {
  try { const url = new URL(value ?? ''); return /^https?:$/.test(url.protocol) && !url.username && !url.password && /^\/payment-request\/[a-f0-9]{64}$/.test(url.pathname) && !url.search && !url.hash ? url.href : ''; }
  catch { return ''; }
}

/** A request is an invitation to pay. It never creates a receipt or reserves stock. */
export function SalePaymentRequests({ sale, onSaved, actionOnly = false, onDirtyChange, onBusyChange }: SalePaymentRequestsProps) {
  const features = useDealerFeatures();
  const {settings} = useDealerSettings();
  const calculation = useSaleCalculationCheck();
  const preparedAt = useRef(new Date().toISOString());
  const initialDate = useRef(todayLondon());
  const [formOpen, setFormOpen] = useState(actionOnly);
  const [kind, setKind] = useState<'deposit' | 'balance' | 'other'>('deposit');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(initialDate.current);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [link, setLink] = useState<{ requestId: string; url: string }>();
  const [confirmation, setConfirmation] = useState<{ kind: 'email' | 'renew' | 'cancel'; request: SalePaymentRequest }>();
  const inFlight = useRef(false), retries = useRef(new Map<string, string>());
  const controller = useRef<AbortController | null>(null), generation = useRef(0), mounted = useRef(false);
  const currentSaleId = useRef(sale.id); currentSaleId.current = sale.id;
  const savedCallback = useRef(onSaved); savedCallback.current = onSaved;
  const [showPreview, setShowPreview] = useState(() => typeof window === 'undefined' || window.innerWidth > 780);
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  const now = new Date().toISOString();
  const requests = [...(sale.paymentRequests ?? [])].reverse();
  const active = requests.find(request => salePaymentRequestAvailable(sale, request, now) && salePaymentRequestRemaining(sale, request) > 0);
  const closed = sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' || sale.returnReplacement?.direction === 'returned';
  useEffect(() => {
    mounted.current = true; generation.current++; inFlight.current = false; setBusy(false);
    initialDate.current = todayLondon(); preparedAt.current = new Date().toISOString();
    setLink(undefined); setConfirmation(undefined); setFormOpen(actionOnly); setError(''); setNotice('');
    setKind('deposit'); setAmount(''); setNote(''); setDueDate(initialDate.current); retries.current.clear();
    return () => { mounted.current = false; generation.current++; controller.current?.abort(); };
  }, [sale.id,actionOnly]);
  const dirty = Boolean(amount.trim() || note.trim() || kind !== 'deposit' || dueDate !== initialDate.current);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty,onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy,onBusyChange]);
  const financialKey = JSON.stringify([sale.id,amount,saleCalculationFigures(sale.draft),sale.payments,sale.draft.creditEntries,sale.draft.returnCreditPence]);
  useEffect(() => { calculation.reset(); }, [financialKey,calculation.reset]);
  const previewDraft = {...sale.draft,payments:sale.payments};
  const draftDocument = buildDraftSaleDocument({draft:previewDraft,dealer:settings,documentType:'Sales invoice',preparedAt:preparedAt.current});
  const parsedAmount = saleWorkspacePence(amount);
  const requestedAmount = Number.isSafeInteger(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0;
  const requestPreview = {...draftDocument, type:'payment-request' as const,title:kind === 'deposit' ? 'Deposit request' : 'Payment request',transaction:{kind:'payment-request' as const,requestKind:kind,amountPence:requestedAmount,dueDate,paymentReference:'Draft',saleReference:sale.reference,note}};

  async function operation(action: string, payload: Record<string, unknown>, task: RequestTask) {
    const body = { expectedRevision: sale.revision, ...payload }, fingerprint = JSON.stringify([sale.id, action, body]);
    const requestId = retries.current.get(fingerprint) ?? requestUuid(); retries.current.set(fingerprint, requestId);
    const result = await customFetch<OperationResult>(`/api/sale-operations/${encodeURIComponent(sale.id)}/${action}`, { method: 'POST', body: JSON.stringify({ ...body, requestId }), signal: task.signal });
    task.ensureCurrent();
    if (!result.sale || result.sale.id !== sale.id) throw new Error('The saved deal could not be confirmed. Reload it before retrying.');
    retries.current.delete(fingerprint); savedCallback.current(result.sale); task.ensureCurrent();
    const url = paymentUrl(result.url);
    if (url && result.requestId) setLink({ requestId: result.requestId, url });
    return result;
  }
  async function run(task: (request: RequestTask) => Promise<void>) {
    if (inFlight.current) return;
    const selectedSale = sale.id, attempt = ++generation.current, request = new AbortController(); controller.current = request;
    const isCurrent = () => mounted.current && generation.current === attempt && currentSaleId.current === selectedSale && !request.signal.aborted;
    const ensureCurrent = () => { if (!isCurrent()) throw new DOMException('The selected sale changed.', 'AbortError'); };
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try { await task({signal:request.signal,ensureCurrent}); } catch (cause) { if (isCurrent()) setError(errorText(cause)); }
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
        if (!features.enabled('customerEmails')) throw new Error('Customer email sending is not available. Download the PDF or share the private link.');
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
      } else {
        await operation(selected.kind === 'renew' ? 'renew-request-link' : 'cancel-request', { paymentRequestId: selected.request.id }, task);
        if (selected.kind === 'cancel') { setLink(current => current?.requestId === selected.request.id ? undefined : current); setFormOpen(actionOnly); setNotice('Payment request cancelled. No money or stock status changed.'); }
        else setNotice('New private link ready. The previous link no longer works.');
      }
      setConfirmation(undefined);
    });
  }
  return <section className={`sale-desk-sheet sale-payment-requests${actionOnly ? ' sale-request-action' : ''}`} aria-label="Payment requests" aria-busy={busy}>
    <div className="sale-request-main">
    <div className="sale-desk-inline-heading"><div><h2><Wallet size={19} aria-hidden="true"/>Request a payment</h2><p>Ask for a deposit, balance or another agreed amount.</p></div>
      {!closed && !active && totals.balance > 0 && (!actionOnly || !formOpen) && <Button disabled={busy} onClick={() => { setFormOpen(!formOpen); setError(''); }}><Plus size={16}/>{formOpen ? 'Close request' : 'New request'}</Button>}
    </div>
    {error && <p className="invoice-error" role="alert">{error}</p>}
    {notice && <p className="invoice-message" role="status">{notice}</p>}
    {closed ? <p>This deal is closed. Open the current deal to request a payment.</p> : totals.balance <= 0 ? <p>No payment is due on this deal.</p> : active ? <p className="sale-request-help">A request is already open. Settle or cancel it before asking for another payment.</p> : !requests.length && !formOpen ? <p className="sale-desk-empty-inline">No payment requested yet. Received payments are recorded separately below.</p> : null}
    {formOpen && !closed && !active && totals.balance > 0 && <form onSubmit={event => { event.preventDefault(); void run(async task => { const result = await operation('request-payment', { kind, amount, dueDate, note }, task); setFormOpen(false); setKind('deposit'); setAmount(''); setNote(''); setDueDate(initialDate.current); setNotice(paymentUrl(result.url) ? 'Payment request saved. Choose how to share it.' : 'Payment request saved. Create a private link below to share it.'); }); }}>
      <fieldset disabled={busy}><div className="sale-request-fields">
        <label>Request type<select value={kind} onChange={event => { const next = event.target.value as typeof kind; setKind(next); if (next === 'balance') setAmount((totals.balance / 100).toFixed(2)); }}><option value="deposit">Deposit</option><option value="balance">Remaining balance</option><option value="other">Other agreed amount</option></select></label>
        <label>Amount (£)<Input required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="For example, 250.00"/><div className="sales-flow-amounts">{[10000,25000,50000].filter(value => value <= totals.balance).map(value => <button type="button" key={value} onClick={() => setAmount((value/100).toFixed(2))}>{saleMoney(value)}</button>)}</div></label>
        <label>Pay by<Input required type="date" value={dueDate} onChange={event => setDueDate(event.target.value)}/></label>
      </div><details className="sales-flow-optional"><summary>Add a note (optional)</summary><label>For the customer<Textarea rows={2} value={note} maxLength={1200} onChange={event => setNote(event.target.value)} placeholder="Only include what you have agreed with the customer."/></label></details>
      <p className="sale-request-help">Creating a request does not record payment or reserve the car.</p>
      {amount.trim() && !Number.isSafeInteger(parsedAmount) && <p role="alert">Enter pounds and pence, for example 250.00.</p>}
      {requestedAmount > totals.balance && <p role="alert">The request is more than the balance left to pay.</p>}
      <Button type="submit" disabled={busy || requestedAmount <= 0 || requestedAmount > totals.balance || !dueDate}>{busy ? 'Saving request…' : `Request ${requestedAmount > 0 ? saleMoney(requestedAmount) : 'payment'}`}</Button></fieldset>
    </form>}
    {requests.length > 0 && <div className="sale-request-list">{requests.map(request => {
      const available = salePaymentRequestAvailable(sale, request, now), remaining = salePaymentRequestRemaining(sale, request);
      const status = request.status === 'cancelled' ? 'Cancelled' : !available ? 'Expired or changed' : remaining === 0 ? 'Settled' : 'Awaiting payment';
      const url = link?.requestId === request.id && available ? link.url : '';
      const message = `Hi ${sale.draft.customer}, please find your ${request.kind === 'deposit' ? 'deposit' : 'payment'} request for ${sale.draft.vehicle} (${sale.draft.registration}). Amount to pay: ${saleMoney(remaining)}. ${url}`;
      const whatsapp = url ? customerWhatsAppUrl(sale.draft.phone, message) : null;
      return <article key={request.id} className="sale-request-row"><div className="sale-request-row-heading"><div><strong>{request.kind === 'deposit' ? 'Deposit' : request.kind === 'balance' ? 'Remaining balance' : 'Agreed payment'} · {saleMoney(request.amountPence)}</strong><small>{request.reference} · Due {request.dueDate}</small></div><span data-status={status}>{status}</span></div>
        {available && remaining > 0 && remaining !== request.amountPence && <p>Still to pay: <strong>{saleMoney(remaining)}</strong></p>}
        {request.paymentReportedAt && <p className="sale-request-reported">Customer says they have paid. Check the funds before recording payment.</p>}
        {request.invoiceRequestedAt && <p>Customer requested an invoice.</p>}
        {url && <label className="sale-request-private-link">Private customer link<Input aria-label="Private customer link" value={url} readOnly onFocus={event => event.target.select()}/><small>Share only with this customer. The link gives access to this payment request.</small></label>}
        <div className="sale-request-actions">
          <Button variant="outline" disabled={busy} onClick={() => void run(task => download(request, task))}><Download size={15}/>PDF</Button>
          {available && remaining > 0 && <>
            {url ? <><Button variant="outline" disabled={busy || !navigator.clipboard?.writeText} onClick={() => void run(async task => { await navigator.clipboard.writeText(url); task.ensureCurrent(); setNotice('Private payment link copied.'); })}><Copy size={15}/>Copy link</Button>{whatsapp ? <Button asChild variant="outline"><a href={whatsapp} target="_blank" rel="noopener noreferrer">Open WhatsApp</a></Button> : <span className="sale-request-help">Add a valid mobile number to use WhatsApp.</span>}</> : <Button variant="outline" disabled={busy} onClick={() => { setError(''); setConfirmation({ kind: 'renew', request }); }}><RefreshCw size={15}/>Create new link</Button>}
            <Button variant="outline" disabled={busy || !features.enabled('customerEmails') || !sale.draft.email} title={!features.enabled('customerEmails') ? 'Customer email sending is unavailable.' : !sale.draft.email ? 'Add the customer email address first.' : undefined} onClick={() => { setError(''); setConfirmation({ kind: 'email', request }); }}><Mail size={15}/>Email PDF</Button>
            <Button variant="ghost" disabled={busy} onClick={() => { setError(''); setConfirmation({ kind: 'cancel', request }); }}>Cancel request</Button>
          </>}
        </div>
      </article>;
    })}</div>}
    </div>
    {actionOnly && formOpen && !closed && !active && totals.balance > 0 && <details className="sales-flow-preview sales-flow-mobile-preview sale-request-preview" open={showPreview} onToggle={event => setShowPreview(event.currentTarget.open)}><summary>View document</summary><LiveSalesDocument key={sale.id} draft={previewDraft} dealer={settings} documentType="Sales invoice" previewDocument={requestPreview} onPreview={async () => {await calculation.check(sale);}}/><CalculationCheck result={calculation.result} busy={calculation.busy} error={calculation.error}/></details>}
    {confirmation && <Dialog open onOpenChange={open => { if (!open && !busy) setConfirmation(undefined); }}><DialogContent className="portal-action-dialog sales-action-dialog z-[90]" overlayClassName="z-[89]" closeDisabled={busy}>
      <DialogHeader><DialogTitle>{confirmation.kind === 'email' ? 'Email this payment request?' : confirmation.kind === 'renew' ? 'Create a new private link?' : 'Cancel this payment request?'}</DialogTitle><DialogDescription>{confirmation.kind === 'email' ? `Send the saved payment request PDF to ${sale.draft.email}. This asks for payment and does not confirm a receipt.` : confirmation.kind === 'renew' ? 'Any previously shared link for this request will stop working. You can then copy the new link or open WhatsApp.' : 'The customer link will stop working. Recorded payments, invoices and the car’s status will be kept.'}</DialogDescription></DialogHeader>
      <p>{confirmation.request.reference} · {saleMoney(confirmation.request.amountPence)} · {sale.draft.vehicle}</p>{error && <p role="alert" className="invoice-error">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmation(undefined)}>Go back</Button><Button disabled={busy} onClick={() => void confirmAction()}>{busy ? 'Working…' : confirmation.kind === 'email' ? 'Send payment request email' : confirmation.kind === 'renew' ? 'Create new link' : 'Cancel payment request'}</Button></DialogFooter>
    </DialogContent></Dialog>}
  </section>;
}
