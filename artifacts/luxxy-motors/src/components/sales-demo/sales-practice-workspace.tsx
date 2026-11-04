import { useEffect, useRef, useState, type ReactNode } from 'react';
import { saleWorkspacePence, saleWorkspaceTotals, vehicleRegistration, type SaleWorkspaceDocument, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft } from '@/components/icons';
import { VehicleChooser } from '@/components/vehicle-chooser';
import { SaleVehiclePhoto } from './vehicle-choice';
import { SalesActionMenu, SalesFlowSteps, type SaleAction } from './sales-action-menu';
import { SaleProgress, SaleTimeline } from './sale-progress';
import { buildDraftSaleDocument, LiveSalesDocument } from './sales-document';
import { emptyDraft, type SaleDraft } from './model';
import { applyTestSaleCommand, applyTestSaleOperation, createTestSale, practiceDealer } from './sales-practice';
import { saleMoney, todayLondon } from './sales-controls';
import './sales-practice-workspace.css';

/** Isolated practice surface: reads only its copied stock and never mounts any live mutation component. */
export function SalesPracticeWorkspace({ cars, dealer, onExit }: {
  cars: Car[]; dealer: DealerConfig; onExit: () => void; quickActions?: ReactNode;
}) {
  const scrollPane = useRef<HTMLElement>(null);
  const preparedAt = useRef(new Date().toISOString());
  const [stock, setStock] = useState(() => structuredClone(cars));
  const [showPreview, setShowPreview] = useState(() => typeof window === 'undefined' || window.innerWidth > 780);
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
    setAction(next); setDocument(undefined); setError(''); setNotice(''); setConfirmed(false); setHandover(false); setMarkSold(false); setOutstanding(false);
    if (next === 'payment') setAmount((Math.abs(total.balance) / 100).toFixed(2));
    if (next === 'return') setCredit((Math.max(0, total.confirmedPaid) / 100).toFixed(2));
  }
  function perform() {
    run(() => {
      let current = saved();
      let nextDocument: SaleWorkspaceDocument | undefined;
      if (action === 'request') {
        const result = applyTestSaleOperation(current, { action: 'request-payment', kind: requestKind, amount, dueDate: date, note }, car, localDealer);
        current = result.sale; nextDocument = result.document;
        setNotice('Request prepared locally. No link or message was sent.');
      } else if (action === 'deposit' || action === 'payment') {
        if (!confirmed) throw new Error('Confirm the practice receipt before recording it.');
        if (action === 'payment' && total.balance < 0) {
          const result = applyTestSaleOperation(current, { action: 'refund-credit', amount, method, date, confirmReceived: true }, car, localDealer);
          accept(result.sale, result.document); setConfirmed(false); setNotice('Refund recorded. No money was sent.'); return;
        }
        const final = action === 'payment' && saleWorkspacePence(amount) === saleWorkspaceTotals(current.draft, current.payments).balance;
        current = applyTestSaleCommand(current, { action: 'invoice-payment', payment: { amount, method, date, reference: 'Practice receipt', kind: action === 'deposit' ? 'deposit' : final ? 'final-payment' : 'part-payment', status: 'confirmed' } }, car, localDealer).sale;
        setConfirmed(false); setNotice(action === 'deposit' ? 'Deposit recorded. Only the copied practice car is reserved.' : 'Payment recorded on this practice sale.');
      } else if (action === 'invoice') {
        const result = applyTestSaleCommand(current, { action: 'issue-invoice', kind: invoiceKind, acknowledge: true }, car, localDealer);
        current = result.sale; nextDocument = result.document;
        if (markSold && invoiceKind === 'full') current = applyTestSaleCommand(current, { action: 'finish-invoice-sale', acknowledge: true, acknowledgeOutstanding: outstanding }, car, localDealer).sale;
        setNotice('Practice invoice prepared. Preview PDF to open a test copy.');
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
  const preview = document ?? (() => {
    const base = buildDraftSaleDocument({ preparedAt: preparedAt.current, draft: liveDraft, dealer: localDealer, vehicle: car, documentType: 'Sales invoice' });
    if (action === 'request') {
      const requested = saleWorkspacePence(amount);
      return { ...base, type: 'payment-request' as const, title: 'Payment request', transaction: { kind: 'payment-request' as const, requestKind, amountPence: Number.isSafeInteger(requested) && requested > 0 ? requested : 0, dueDate: date, paymentReference: sale?.reference || 'TEST-DRAFT', saleReference: sale?.reference || 'TEST-DRAFT', ...(note ? { note } : {}) } };
    }
    return base;
  })();
  const update = (key: keyof SaleDraft, value: string) => { setDraft(previous => ({ ...previous, [key]: value })); setDocument(undefined); };
  const showDocument = step === 1 || (step === 2 && Boolean(action));
  const refunding = action === 'payment' && total.balance < 0;
  return <div className="invoice-builder sale-desk sales-flow sales-practice-workspace is-editing" data-flow-screen={step === 0 ? 'car' : step === 1 ? 'customer' : action || 'menu'}>
    <header className="invoice-builder-header sale-desk-header"><div className="sale-desk-header-identity"><Button variant="ghost" onClick={onExit}><ArrowLeft size={17}/>Sales</Button>{dealer.identity.logoAsset ? <img className="sales-flow-logo" src={dealer.identity.logoAsset} alt={dealer.identity.name}/> : <strong>{dealer.identity.name}</strong>}<small>TEST ONLY</small></div><Button variant="outline" onClick={() => { setSale(null); setDocument(undefined); setDraft({ ...emptyDraft(), customer: 'Alex Example', email: 'alex@example.invalid', phone: '07700900123', address: '1 Example Road\nExample Town\nEX1 1AA' }); setStep(0); setAction(undefined); setError(''); setNotice(''); }}>Start another</Button></header>
    <SalesFlowSteps step={step} onChoose={setStep}/>
    <main ref={scrollPane} className={`sales-practice-layout${showDocument ? ' has-preview' : ''}`}><div className="sales-practice-main">
      {draft.vehicleId && step !== 0 && <div className="sales-flow-context"><div>{car && <SaleVehiclePhoto car={car}/>}<span><strong>{draft.vehicle}</strong><small>{draft.registration} · {saleMoney(saleWorkspacePence(draft.price))}</small></span><Button variant="ghost" onClick={() => setStep(0)}>Change</Button></div><div><span><strong>{draft.customer || 'Choose customer'}</strong><small>{sale?.reference || 'New sale'}</small></span><Button variant="ghost" onClick={() => setStep(1)}>Change</Button></div><SaleProgress sale={sale}/></div>}
      {error && <p role="alert" className="invoice-error">{error}</p>}{notice && <p role="status" className="invoice-message">{notice}</p>}
      {step === 0 && <section className="sale-desk-sheet"><h1>Choose a car</h1><VehicleChooser cars={stock.filter(row => row.id === draft.vehicleId || !['sold', 'hidden', 'archived', 'reserved'].includes(String(row.inventoryStatus)))} value={draft.vehicleId} savedLabel={draft.vehicle} disabled={Boolean(sale?.lifecycle && sale.lifecycle.status !== 'draft')} onChange={id => { const selected = stock.find(row => row.id === id); if (selected) setDraft({ ...draft, vehicleId: id, vehicle: selected.title || `${selected.make ?? ''} ${selected.model ?? ''}`.trim(), registration: vehicleRegistration(selected), price: String(selected.price ?? '') }); }}/><label>Agreed vehicle price (£)<Input value={draft.price} inputMode="decimal" onChange={event => update('price', event.target.value)}/></label><Button disabled={!draft.vehicleId} onClick={() => setStep(1)}>Customer details</Button></section>}
      {step === 1 && <section className="sale-desk-sheet"><h1>Customer</h1><label>Full name<Input value={draft.customer} onChange={event => update('customer', event.target.value)}/></label><div className="invoice-field-grid"><label>Phone<Input value={draft.phone} onChange={event => update('phone', event.target.value)}/></label><label>Email<Input value={draft.email} onChange={event => update('email', event.target.value)}/></label></div><label>Address<Textarea rows={3} value={draft.address} onChange={event => update('address', event.target.value)}/></label><Button disabled={!draft.customer.trim()} onClick={() => run(() => { accept(saved()); setStep(2); })}>Choose what to do</Button></section>}
      {step === 2 && <><div className="sales-practice-choice"><h1>{action ? ({ request: 'Request a deposit', deposit: 'Take a deposit', payment: refunding ? 'Record a refund' : 'Take a payment', invoice: 'Create an invoice', handover: 'Collection or delivery', return: 'Return or change a car' }[action]) : 'What would you like to do?'}</h1>{action && <Button variant="outline" onClick={() => { setAction(undefined); setDocument(undefined); }}>Other actions</Button>}</div>
        {!action ? <><SalesActionMenu onChoose={choose} unavailable={{ return: !sale?.completedAt ? 'Complete this practice sale first.' : undefined, ...(total.balance < 0 ? { payment: 'Use Record refunded credit below.' } : {}) }}/>{total.balance < 0 && <Button onClick={() => choose('payment')}>Record refunded credit</Button>}</>: <form className="sale-desk-sheet sales-practice-form" onSubmit={event => { event.preventDefault(); perform(); }}>
          {action === 'request' && <><label>Request type<select value={requestKind} onChange={event => { const next = event.target.value as typeof requestKind; setRequestKind(next); if (next === 'balance') setAmount((Math.max(0, total.balance) / 100).toFixed(2)); setDocument(undefined); }}><option value="deposit">Deposit</option><option value="balance">Remaining balance</option><option value="other">Other agreed amount</option></select></label><label>Customer note (optional)<Textarea value={note} rows={2} onChange={event => { setNote(event.target.value); setDocument(undefined); }}/></label></>}
          {['request', 'deposit', 'payment'].includes(action) && <><label>Amount (£)<Input inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false); setDocument(undefined); }}/></label><label>{action === 'request' ? 'Due date' : refunding ? 'Actual refund date' : 'Date received'}<Input type="date" value={date} onChange={event => { setDate(event.target.value); setConfirmed(false); setDocument(undefined); }}/></label></>}
          {(action === 'deposit' || action === 'payment') && <><label>Payment method<select value={method} onChange={event => { setMethod(event.target.value); setConfirmed(false); }}>{['Bank transfer', 'Cash', 'Debit card', 'Credit card', 'Finance', 'Other'].map(value => <option key={value}>{value}</option>)}</select></label><label className="invoice-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>{refunding ? 'I have checked the refund has actually been paid.' : 'I have checked that the money has been received.'}</label></>}
          {action === 'invoice' && <><label>Invoice type<select value={invoiceKind} onChange={event => setInvoiceKind(event.target.value as typeof invoiceKind)}><option value="full">Sales invoice</option><option value="deposit">Received deposit invoice</option></select></label>{invoiceKind === 'full' && <label className="invoice-check"><input type="checkbox" checked={markSold} onChange={event => setMarkSold(event.target.checked)}/>Mark the copied car sold after creating the invoice</label>}{markSold && total.balance > 0 && <label className="invoice-check"><input type="checkbox" checked={outstanding} onChange={event => setOutstanding(event.target.checked)}/>Acknowledge the outstanding balance</label>}</>}
          {action === 'handover' && <><label>How will the customer receive the car?<select value={delivery ? 'delivery' : 'collection'} onChange={event => setDelivery(event.target.value === 'delivery')}><option value="collection">Customer collecting</option><option value="delivery">Deliver to customer</option></select></label><label>Planned date<Input type="date" value={date} onChange={event => setDate(event.target.value)}/></label>{delivery && <><label>Delivery address<Textarea value={address} rows={2} onChange={event => setAddress(event.target.value)}/></label><label>Delivery charge (£)<Input inputMode="decimal" value={charge} onChange={event => setCharge(event.target.value)}/></label></>}<label className="invoice-check"><input type="checkbox" checked={handover} onChange={event => setHandover(event.target.checked)}/>Also simulate the completed handover</label>{handover && total.balance > 0 && <label className="invoice-check"><input type="checkbox" checked={outstanding} onChange={event => setOutstanding(event.target.checked)}/>Acknowledge the outstanding balance</label>}</>}
          {action === 'return' && <><label>Next step<select value={replace ? 'replace' : 'return'} onChange={event => setReplace(event.target.value === 'replace')}><option value="return">Return car only</option><option value="replace">Return and replace</option></select></label>{replace && <><label>Replacement car<select value={replacementId} onChange={event => { setReplacementId(event.target.value); const selected = stock.find(row => row.id === event.target.value); setReplacementPrice(String(selected?.price ?? '')); }}><option value="">Choose another car</option>{stock.filter(row => row.id !== draft.vehicleId && !['sold', 'hidden', 'archived', 'reserved'].includes(String(row.inventoryStatus))).map(row => <option key={row.id} value={row.id}>{row.title} · {row.registration || row.plate || row.vrm}</option>)}</select></label><label>Replacement price (£)<Input value={replacementPrice} inputMode="decimal" onChange={event => setReplacementPrice(event.target.value)}/></label></>}<label>Agreed return credit (£)<Input value={credit} inputMode="decimal" onChange={event => setCredit(event.target.value)}/></label><label>Returned mileage<Input value={mileage} inputMode="numeric" onChange={event => setMileage(event.target.value)}/></label><label>Return date<Input type="date" value={date} onChange={event => setDate(event.target.value)}/></label><label>Reason<Textarea value={reason} rows={2} onChange={event => setReason(event.target.value)}/></label><label>Condition<Textarea value={condition} rows={2} onChange={event => setCondition(event.target.value)}/></label><label className="invoice-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>Assume the car is returned, credit agreed and any third-party settlement resolved.</label></>}
          <Button type="submit">{({ request: 'Prepare request', deposit: 'Record deposit', payment: refunding ? 'Record refund' : 'Record payment', invoice: 'Create invoice', handover: 'Save arrangements', return: replace ? 'Return and create replacement' : 'Record return' }[action])}</Button>
        </form>}
      </>}
      {sale && <SaleTimeline sale={sale}/>}
      {history.length > 1 && <details className="sale-desk-fold"><summary>Practice sales ({history.length})</summary>{history.map(row => <Button key={row.id} variant="ghost" onClick={() => { accept(row); setStep(2); setAction(undefined); }}>{row.draft.vehicle} · {row.reference}</Button>)}</details>}
    </div>{showDocument && <details className="sales-practice-preview" open={showPreview} onToggle={event => setShowPreview(event.currentTarget.open)}><summary>View document</summary><LiveSalesDocument previewDocument={preview} draft={liveDraft} dealer={localDealer} vehicle={car} documentType="Sales invoice" testMode/></details>}</main>
    <footer className="sales-flow-footer sales-practice-footer"><strong>TEST ONLY</strong><div className="sales-flow-money"><span>Total <strong>{saleMoney(total.totalDue)}</strong></span><span>Paid <strong>{saleMoney(total.confirmedPaid)}</strong></span><span>{total.balance < 0 ? 'To return' : 'Left to pay'} <strong>{saleMoney(Math.abs(total.balance))}</strong></span></div></footer>
  </div>;
}
