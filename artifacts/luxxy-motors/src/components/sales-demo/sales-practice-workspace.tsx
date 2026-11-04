import { useEffect, useRef, useState, type ReactNode } from 'react';
import { salePaymentRequestAvailable, salePaymentRequestRemaining, saleWorkspacePence, saleWorkspaceTotals, vehicleRegistration, type SaleWorkspaceDocument, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, ArrowRight, Check, Download, Wallet } from '@/components/icons';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { VehicleChooser } from '@/components/vehicle-chooser';
import { SaleVehiclePhoto } from './vehicle-choice';
import { SalesActionMenu, SalesFlowSteps, type SaleAction } from './sales-action-menu';
import { SaleProgress, SaleTimeline } from './sale-progress';
import { emptyDraft, type SaleDraft } from './model';
import { applyTestSaleCommand, applyTestSaleOperation, createTestSale, practiceDealer } from './sales-practice';
import { saleMoney, todayLondon } from './sales-controls';
import './sales-practice-workspace.css';

/** Isolated practice surface: reads only its copied stock and never mounts any live mutation component. */
export function SalesPracticeWorkspace({ cars, dealer, onExit }: {
  cars: Car[]; dealer: DealerConfig; onExit: () => void; quickActions?: ReactNode;
}) {
  const scrollPane = useRef<HTMLElement>(null);
  const [stock, setStock] = useState(() => structuredClone(cars));
  const [reserveDialog, setReserveDialog] = useState(false), [acceptShortfall, setAcceptShortfall] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const pdfCache = useRef(new Map<string, Blob>());
  const [draft, setDraft] = useState<SaleDraft>(() => ({ ...emptyDraft(), customer: 'Alex Example', email: 'alex@example.invalid', phone: '07700900123', address: '1 Example Road\nExample Town\nEX1 1AA' }));
  const [step, setStep] = useState<0 | 1 | 2>(0), [action, setAction] = useState<SaleAction>();
  useEffect(() => { if (scrollPane.current) { scrollPane.current.scrollTop = 0; } }, [step, action]);
  const [sale, setSale] = useState<SaleWorkspaceRecord | null>(null), [history, setHistory] = useState<SaleWorkspaceRecord[]>([]);
  const [document, setDocument] = useState<SaleWorkspaceDocument>(), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const [amount, setAmount] = useState('200.00'), [date, setDate] = useState(todayLondon()), [method, setMethod] = useState('Bank transfer');
  const [requestKind, setRequestKind] = useState<'deposit' | 'balance' | 'other'>('deposit'), [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [invoiceKind, setInvoiceKind] = useState<'full' | 'deposit'>('full'), [markSold, setMarkSold] = useState(false), [outstanding, setOutstanding] = useState(false);
  const [delivery, setDelivery] = useState(false), [address, setAddress] = useState(''), [charge, setCharge] = useState('0'), [handover, setHandover] = useState(false);
  const [replace, setReplace] = useState(false), [replacementId, setReplacementId] = useState(''), [replacementPrice, setReplacementPrice] = useState(''), [credit, setCredit] = useState(''), [reason, setReason] = useState(''), [condition, setCondition] = useState(''), [mileage, setMileage] = useState('');
  const car = stock.find(row => row.id === draft.vehicleId);
  const localDealer = practiceDealer(dealer);
  const liveDraft = { ...draft, payments: sale?.payments ?? [] };
  const total = saleWorkspaceTotals({ ...liveDraft, payments: sale?.payments ?? [] }, sale?.payments ?? []);
  const deliveryPence = saleWorkspacePence(draft.deliveryCharge ?? ''), otherCharges = total.adjustments - deliveryPence;
  const depositRequest = sale && [...(sale.paymentRequests ?? [])].reverse().find(request => request.kind === 'deposit' && salePaymentRequestAvailable(sale, request, new Date().toISOString()));
  const requestedDeposit = depositRequest && sale ? salePaymentRequestRemaining(sale, depositRequest) : 0;
  const shortfall = Math.max(0, requestedDeposit - saleWorkspacePence(amount));
  const logo = isMultiChoiceWebsite() ? '/brand/multi-choice-motors/multi-choice-wordmark.svg' : dealer.identity.logoAsset;
  function accept(next: SaleWorkspaceRecord, nextDocument?: SaleWorkspaceDocument) {
    setSale(next); setDraft(next.draft); setDocument(nextDocument);
    setHistory(rows => [...rows.filter(row => row.id !== next.id), next]);
    setStock(rows => rows.map(row => row.id === next.draft.vehicleId ? { ...row, inventoryStatus: next.lifecycle?.status === 'returned' ? 'hidden' : next.lifecycle?.status ?? row.inventoryStatus } : row));
  }
  function saved() {
    if (sale && JSON.stringify(sale.draft) === JSON.stringify(draft)) return sale;
    if (sale?.standaloneReturn || sale?.returnReplacement?.direction === 'returned') return sale;
    return sale ? applyTestSaleCommand(sale, { action: 'update', draft: { ...draft, payments: [] } }, car, localDealer).sale : createTestSale(draft, car, localDealer);
  }
  function run(task: () => void) {
    setError(''); setNotice('');
    try { task(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the entered details.'); }
  }
  function choose(next: SaleAction) {
    setAction(next); setDocument(undefined); setError(''); setNotice(''); setConfirmed(false); setHandover(false); setMarkSold(false); setOutstanding(false); setReserveDialog(false); setAcceptShortfall(false);
    if (next === 'deposit' && requestedDeposit > 0) setAmount((requestedDeposit / 100).toFixed(2));
    if (next === 'payment') setAmount((Math.abs(total.balance) / 100).toFixed(2));
    if (next === 'return') setCredit((Math.max(0, total.confirmedPaid) / 100).toFixed(2));
  }
  function perform(reservationAccepted = false) {
    run(() => {
      if (action === 'deposit' && !reservationAccepted) {
        if (!confirmed) throw new Error('Check that the deposit has arrived before recording it.');
        const received = saleWorkspacePence(amount);
        if (!Number.isSafeInteger(received) || received <= 0 || received > total.balance) throw new Error('Enter a deposit greater than zero and no more than the balance.');
        setReserveDialog(true); return;
      }
      let current = saved();
      let nextDocument: SaleWorkspaceDocument | undefined;
      if (action === 'request') {
        const result = applyTestSaleOperation(current, { action: 'request-payment', kind: requestKind, amount, dueDate: date, note }, car, localDealer);
        current = result.sale; nextDocument = result.document;
        setNotice('Deposit request prepared. No message was sent.');
      } else if (action === 'deposit' || action === 'payment') {
        if (!confirmed) throw new Error('Confirm the practice receipt before recording it.');
        if (action === 'payment' && total.balance < 0) {
          const result = applyTestSaleOperation(current, { action: 'refund-credit', amount, method, date, confirmReceived: true }, car, localDealer);
          accept(result.sale, result.document); setConfirmed(false); setNotice('Refund recorded. No money was sent.'); return;
        }
        const final = action === 'payment' && saleWorkspacePence(amount) === saleWorkspaceTotals(current.draft, current.payments).balance;
        const result = applyTestSaleCommand(current, { action: 'invoice-payment', payment: { amount, method, date, reference: 'Practice receipt', kind: action === 'deposit' ? 'deposit' : final ? 'final-payment' : 'part-payment', status: 'confirmed', ...(action === 'deposit' ? { reserveConfirmed: reservationAccepted, ...(depositRequest ? { paymentRequestId: depositRequest.id, acceptShortfall } : {}) } : {}) } }, car, localDealer);
        current = result.sale; nextDocument = result.document;
        setConfirmed(false); setReserveDialog(false); setAcceptShortfall(false);
        setNotice(action === 'deposit' ? `${saleMoney(saleWorkspacePence(amount))} deposit recorded. Car reserved. ${saleMoney(saleWorkspaceTotals(current.draft, current.payments).balance)} left to pay.` : 'Payment recorded on this practice sale.');
      } else if (action === 'invoice') {
        const result = applyTestSaleCommand(current, { action: 'issue-invoice', kind: invoiceKind, acknowledge: true }, car, localDealer);
        current = result.sale; nextDocument = result.document;
        if (markSold && invoiceKind === 'full') current = applyTestSaleCommand(current, { action: 'finish-invoice-sale', acknowledge: true, acknowledgeOutstanding: outstanding }, car, localDealer).sale;
        setNotice('Invoice created. Download the PDF when you need it.');
      } else if (action === 'handover') {
        current = applyTestSaleCommand(current, { action: 'fulfilment', fulfilment: { ...current.draft.fulfilment, method: delivery ? 'delivery' : 'collection', viewed: 'viewed', recipient: current.draft.customer, phone: current.draft.phone, address: delivery ? address : '', scheduledDate: date, timeWindow: '', instructions: '', stage: 'booked' } }, car, localDealer).sale;
        if (delivery) {
          const result = applyTestSaleOperation(current, { action: 'delivery-charge', amount: charge }, car, localDealer);
          current = result.sale; nextDocument = result.document;
        }
        if (handover) {
          const result = applyTestSaleCommand(current, { action: 'handover', recipient: current.draft.customer, acknowledgeOutstanding: outstanding }, car, localDealer);
          current = result.sale; nextDocument = result.document;
        }
        setNotice(handover ? 'Practice handover recorded. No live delivery job was created.' : 'Practice arrangements saved. No confirmation was sent.');
      } else if (action === 'return') {
        if (!confirmed) throw new Error('Confirm the practice return and settlement.');
        if (!/^\d{1,7}$/.test(mileage.trim())) throw new Error('Enter the returned vehicle mileage.');
        const common = { agreedCredit: credit, reason, condition, mileage: Number(mileage), financeConfirmed: true, acknowledge: true };
        if (replace) {
          const replacementCar = stock.find(row => row.id === replacementId);
          if (!replacementCar) throw new Error('Choose a replacement car.');
          const result = applyTestSaleOperation(current, { action: 'return-replace', ...common, replacementCar, replacementPrice }, car, localDealer);
          accept(result.sale, result.document);
          if (result.replacement) { accept(result.replacement); setAction(undefined); }
          setNotice('Practice credit transferred once. You are now in the replacement deal.'); return;
        }
        const result = applyTestSaleOperation(current, { action: 'return-car', ...common, returnedDate: date, received: true }, car, localDealer);
        current = result.sale; nextDocument = result.document;
        setNotice('Practice return recorded. The copied car is held for inspection; no refund money was sent.');
      }
      accept(current, nextDocument);
    });
  }
  async function downloadDocument(selected: SaleWorkspaceDocument) {
    if (downloading) return;
    setDownloading(true); setError('');
    try {
      let blob = pdfCache.current.get(selected.id);
      if (!blob) {
        const { saleDocumentPdfBytes } = await import('@workspace/vehicle-meta/sale-document-pdf');
        const bytes = saleDocumentPdfBytes(selected);
        blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        pdfCache.current.set(selected.id, blob);
      }
      const url = URL.createObjectURL(blob), link = window.document.createElement('a');
      link.href = url; link.download = `${selected.number.replaceAll('/', '-')}.pdf`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The test PDF could not be created. Try again.'); }
    finally { setDownloading(false); }
  }
  const update = (key: keyof SaleDraft, value: string) => { setDraft(previous => ({ ...previous, [key]: value })); setDocument(undefined); };
  const refunding = action === 'payment' && total.balance < 0;
  return <div className="invoice-builder sale-desk sales-flow sales-practice-workspace is-editing" data-flow-screen={step === 0 ? 'car' : step === 1 ? 'customer' : action || 'menu'}>
    <header className="invoice-builder-header sale-desk-header"><div className="sale-desk-header-identity"><Button variant="ghost" onClick={onExit}><ArrowLeft size={17}/>Sales</Button>{logo ? <img className="sales-flow-logo" src={logo} alt={dealer.identity.name}/> : <strong>{dealer.identity.name}</strong>}<small>TEST ONLY</small></div><Button variant="outline" onClick={() => { setSale(null); setDocument(undefined); setDraft({ ...emptyDraft(), customer: 'Alex Example', email: 'alex@example.invalid', phone: '07700900123', address: '1 Example Road\nExample Town\nEX1 1AA' }); setStep(0); setAction(undefined); setError(''); setNotice(''); setReserveDialog(false); setConfirmed(false); setAcceptShortfall(false); }}>Start another</Button></header>
    <SalesFlowSteps step={step} onChoose={setStep}/>
    <main ref={scrollPane} className={`sales-practice-layout${step > 0 ? ' has-summary' : ''}`}><div className="sales-practice-main">
      {draft.vehicleId && step !== 0 && <div className="sales-flow-context"><div>{car && <SaleVehiclePhoto car={car}/>}<span><strong>{draft.vehicle}</strong><small>{draft.registration} · {saleMoney(saleWorkspacePence(draft.price))}</small></span><Button variant="ghost" onClick={() => setStep(0)}>Change</Button></div><div><span><strong>{draft.customer || 'Choose customer'}</strong><small>{sale?.reference || 'New sale'}</small></span><Button variant="ghost" onClick={() => setStep(1)}>Change</Button></div><SaleProgress sale={sale}/></div>}
      {error && <p role="alert" className="invoice-error">{error}</p>}{notice && <p role="status" className="invoice-message">{notice}</p>}
      {step === 0 && <section className="sale-desk-sheet"><h1>Choose a car</h1><VehicleChooser cars={stock.filter(row => row.id === draft.vehicleId || !['sold', 'hidden', 'archived', 'reserved'].includes(String(row.inventoryStatus)))} value={draft.vehicleId} savedLabel={draft.vehicle} disabled={Boolean(sale?.lifecycle && sale.lifecycle.status !== 'draft')} onChange={id => { const selected = stock.find(row => row.id === id); if (selected) setDraft({ ...draft, vehicleId: id, vehicle: selected.title || `${selected.make ?? ''} ${selected.model ?? ''}`.trim(), registration: vehicleRegistration(selected), price: String(selected.price ?? '') }); }}/><label>Agreed vehicle price (£)<Input value={draft.price} inputMode="decimal" onChange={event => update('price', event.target.value)}/></label><Button disabled={!draft.vehicleId} onClick={() => setStep(1)}>Customer details</Button></section>}
      {step === 1 && <section className="sale-desk-sheet"><h1>Customer</h1><label>Full name<Input value={draft.customer} onChange={event => update('customer', event.target.value)}/></label><div className="invoice-field-grid"><label>Phone<Input value={draft.phone} onChange={event => update('phone', event.target.value)}/></label><label>Email<Input value={draft.email} onChange={event => update('email', event.target.value)}/></label></div><label>Address<Textarea rows={3} value={draft.address} onChange={event => update('address', event.target.value)}/></label><Button disabled={!draft.customer.trim()} onClick={() => run(() => { accept(saved()); setStep(2); })}>Choose what to do</Button></section>}
      {step === 2 && <><div className="sales-practice-choice"><h1>{action ? ({ request: 'Request a deposit', deposit: 'Take a deposit', payment: refunding ? 'Record a refund' : 'Take a payment', invoice: 'Create an invoice', handover: 'Collection or delivery', return: 'Return or change a car' }[action]) : 'What would you like to do?'}</h1>{action && <Button variant="outline" onClick={() => { setAction(undefined); setDocument(undefined); }}>Other actions</Button>}</div>
        {!action ? <><SalesActionMenu onChoose={choose} unavailable={{ return: !sale?.completedAt ? 'Complete this practice sale first.' : undefined, ...(total.balance < 0 ? { payment: 'Use Record refunded credit below.' } : {}) }}/>{total.balance < 0 && <Button onClick={() => choose('payment')}>Record refunded credit</Button>}</>: action === 'request' && depositRequest ? <section className="sale-desk-sheet sales-practice-request"><h2>Deposit request ready</h2><p>{saleMoney(depositRequest.amountPence)} requested for {draft.vehicle}.</p><p>Has it arrived? Check the amount before recording the deposit.</p><Button onClick={() => choose('deposit')}>Record the deposit<ArrowRight size={18}/></Button></section> : <form className="sale-desk-sheet sales-practice-form" onSubmit={event => { event.preventDefault(); perform(); }}>
          {action === 'request' && <><label>Request type<select value={requestKind} onChange={event => { const next = event.target.value as typeof requestKind; setRequestKind(next); if (next === 'balance') setAmount((Math.max(0, total.balance) / 100).toFixed(2)); setDocument(undefined); }}><option value="deposit">Deposit</option><option value="balance">Remaining balance</option><option value="other">Other agreed amount</option></select></label><label>Customer note (optional)<Textarea value={note} rows={2} onChange={event => { setNote(event.target.value); setDocument(undefined); }}/></label></>}
          {['request', 'deposit', 'payment'].includes(action) && <><label>Amount (£)<Input inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false); setAcceptShortfall(false); setDocument(undefined); }}/></label>{action === 'deposit' && depositRequest && <p className="sales-practice-requested">Requested {saleMoney(depositRequest.amountPence)}{shortfall > 0 ? ` · ${saleMoney(shortfall)} less than requested` : ''}</p>}<label>{action === 'request' ? 'Due date' : refunding ? 'Actual refund date' : 'Date received'}<Input type="date" value={date} onChange={event => { setDate(event.target.value); setConfirmed(false); setAcceptShortfall(false); setDocument(undefined); }}/></label></>}
          {(action === 'deposit' || action === 'payment') && <><label>Payment method<select value={method} onChange={event => { setMethod(event.target.value); setConfirmed(false); }}>{['Bank transfer', 'Cash', 'Debit card', 'Credit card', 'Finance', 'Other'].map(value => <option key={value}>{value}</option>)}</select></label><label className="invoice-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>{refunding ? 'I have checked the refund has actually been paid.' : 'I have checked that the money has been received.'}</label></>}
          {action === 'invoice' && <><label>Invoice type<select value={invoiceKind} onChange={event => setInvoiceKind(event.target.value as typeof invoiceKind)}><option value="full">Sales invoice</option><option value="deposit">Received deposit invoice</option></select></label>{invoiceKind === 'full' && <label className="invoice-check"><input type="checkbox" checked={markSold} onChange={event => setMarkSold(event.target.checked)}/>Mark the copied car sold after creating the invoice</label>}{markSold && total.balance > 0 && <label className="invoice-check"><input type="checkbox" checked={outstanding} onChange={event => setOutstanding(event.target.checked)}/>Acknowledge the outstanding balance</label>}</>}
          {action === 'handover' && <><label>How will the customer receive the car?<select value={delivery ? 'delivery' : 'collection'} onChange={event => setDelivery(event.target.value === 'delivery')}><option value="collection">Customer collecting</option><option value="delivery">Deliver to customer</option></select></label><label>Planned date<Input type="date" value={date} onChange={event => setDate(event.target.value)}/></label>{delivery && <><label>Delivery address<Textarea value={address} rows={2} onChange={event => setAddress(event.target.value)}/></label><label>Delivery charge (£)<Input inputMode="decimal" value={charge} onChange={event => setCharge(event.target.value)}/></label></>}<label className="invoice-check"><input type="checkbox" checked={handover} onChange={event => setHandover(event.target.checked)}/>Also simulate the completed handover</label>{handover && total.balance > 0 && <label className="invoice-check"><input type="checkbox" checked={outstanding} onChange={event => setOutstanding(event.target.checked)}/>Acknowledge the outstanding balance</label>}</>}
          {action === 'return' && <><label>Next step<select value={replace ? 'replace' : 'return'} onChange={event => setReplace(event.target.value === 'replace')}><option value="return">Return car only</option><option value="replace">Return and replace</option></select></label>{replace && <><label>Replacement car<select value={replacementId} onChange={event => { setReplacementId(event.target.value); const selected = stock.find(row => row.id === event.target.value); setReplacementPrice(String(selected?.price ?? '')); }}><option value="">Choose another car</option>{stock.filter(row => row.id !== draft.vehicleId && !['sold', 'hidden', 'archived', 'reserved'].includes(String(row.inventoryStatus))).map(row => <option key={row.id} value={row.id}>{row.title} · {row.registration || row.plate || row.vrm}</option>)}</select></label><label>Replacement price (£)<Input value={replacementPrice} inputMode="decimal" onChange={event => setReplacementPrice(event.target.value)}/></label></>}<label>Agreed return credit (£)<Input value={credit} inputMode="decimal" onChange={event => setCredit(event.target.value)}/></label><label>Returned mileage<Input value={mileage} inputMode="numeric" onChange={event => setMileage(event.target.value)}/></label><label>Return date<Input type="date" value={date} onChange={event => setDate(event.target.value)}/></label><label>Reason<Textarea value={reason} rows={2} onChange={event => setReason(event.target.value)}/></label><label>Condition<Textarea value={condition} rows={2} onChange={event => setCondition(event.target.value)}/></label><label className="invoice-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>Assume the car is returned, credit agreed and any third-party settlement resolved.</label></>}
          <Button type="submit">{({ request: 'Prepare request', deposit: 'Record deposit', payment: refunding ? 'Record refund' : 'Record payment', invoice: 'Create invoice', handover: 'Save arrangements', return: replace ? 'Return and create replacement' : 'Record return' }[action])}</Button>
        </form>}
      </>}
      {document && <section className="sales-practice-document" aria-label="Saved document"><div><strong>{document.title}</strong><small>{document.number}</small></div><Button variant="outline" disabled={downloading} onClick={() => void downloadDocument(document)}><Download size={18}/>{downloading ? 'Preparing PDF…' : 'Download PDF'}</Button>{action === 'deposit' && total.balance > 0 && <Button onClick={() => choose('payment')}>Take the next payment<ArrowRight size={18}/></Button>}</section>}
      {sale && sale.documents.length > 0 && <details className="sale-desk-fold sales-practice-documents"><summary>Saved documents ({sale.documents.length})</summary>{[...sale.documents].reverse().map(row => <div key={row.id}><span>{row.title}<small>{row.number}</small></span><Button variant="outline" disabled={downloading} onClick={() => void downloadDocument(row)}>Download PDF</Button></div>)}</details>}
      {sale && <SaleTimeline sale={sale}/>}
      {history.length > 1 && <details className="sale-desk-fold"><summary>Practice sales ({history.length})</summary>{history.map(row => <Button key={row.id} variant="ghost" onClick={() => { accept(row); setStep(2); setAction(undefined); }}>{row.draft.vehicle} · {row.reference}</Button>)}</details>}
    </div>{step > 0 && <aside className="sales-practice-summary" aria-label="Money summary"><h2><Wallet size={21}/>Payment breakdown</h2><dl><div><dt>Vehicle price</dt><dd>{saleMoney(total.price)}</dd></div>{deliveryPence > 0 && <div><dt>Delivery</dt><dd>{saleMoney(deliveryPence)}</dd></div>}{total.allowance > 0 && <div><dt>Part exchange</dt><dd>−{saleMoney(total.allowance)}</dd></div>}{otherCharges !== 0 && <div><dt>Other charges / credit</dt><dd>{saleMoney(otherCharges)}</dd></div>}<div className="sales-practice-summary-total"><dt>Sale total</dt><dd>{saleMoney(total.totalDue)}</dd></div><div data-tone="paid"><dt><Check size={16}/>Paid</dt><dd>{saleMoney(total.confirmedPaid)}</dd></div>{total.pending > 0 && <div data-tone="waiting"><dt>Payment to check</dt><dd>{saleMoney(total.pending)}</dd></div>}<div className="sales-practice-summary-balance" data-tone={total.balance === 0 ? 'paid' : 'waiting'}><dt>{total.balance < 0 ? 'To return' : 'Left to pay'}</dt><dd>{saleMoney(Math.abs(total.balance))}</dd></div></dl>{depositRequest && <p className="sales-practice-requested">Deposit requested: {saleMoney(depositRequest.amountPence)}<small>Not yet recorded as paid.</small></p>}</aside>}</main>
    <footer className="sales-flow-footer sales-practice-footer"><strong>TEST ONLY</strong><div className="sales-flow-money"><span>Total <strong>{saleMoney(total.totalDue)}</strong></span><span>Paid <strong>{saleMoney(total.confirmedPaid)}</strong></span><span>{total.balance < 0 ? 'To return' : 'Left to pay'} <strong>{saleMoney(Math.abs(total.balance))}</strong></span></div></footer>
    <Dialog open={reserveDialog} onOpenChange={setReserveDialog}><DialogContent><DialogHeader><DialogTitle>Reserve this car for {draft.customer}?</DialogTitle><DialogDescription>You’re recording a {saleMoney(saleWorkspacePence(amount))} deposit. Confirm that the money has arrived. This will reserve the vehicle and remove it from available stock.</DialogDescription></DialogHeader><p>{draft.vehicle} · {draft.registration}</p>{shortfall > 0 && <div className="sales-practice-shortfall"><p><strong>{saleMoney(shortfall)} less than requested</strong></p><p>You requested {saleMoney(requestedDeposit)} and received {saleMoney(saleWorkspacePence(amount))}. The difference stays in the balance.</p><label className="invoice-check"><input type="checkbox" checked={acceptShortfall} onChange={event => setAcceptShortfall(event.target.checked)}/>Accept {saleMoney(saleWorkspacePence(amount))} as the deposit</label></div>}{error && <p role="alert" className="invoice-error">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setReserveDialog(false)}>Go back</Button><Button disabled={shortfall > 0 && !acceptShortfall} onClick={() => perform(true)}>Confirm {saleMoney(saleWorkspacePence(amount))} &amp; reserve car</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
