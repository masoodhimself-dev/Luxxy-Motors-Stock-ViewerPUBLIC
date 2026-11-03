import { useEffect, useId, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { saleWorkspacePence, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import type { Car as StockCar } from '@/lib/stock-context';
import { vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { requestUuid } from '@/lib/request-uuid';
import { AlertCircle, ArrowRight, CheckCircle2, LoaderCircle, RefreshCw, Search } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { saleMoney, todayLondon } from './sales-controls';
import { SaleReturnInspection } from './sale-return-inspection';
import './sale-return-replace.css';

type Review = NonNullable<SaleWorkspaceRecord['finalReview']>;
type Proposal = { replacementVehicleId: string; replacementPrice: string; agreedCredit: string; reason: string; condition: string; mileage: number; financeConfirmed: boolean; acknowledge: true };
type ReviewedProposal = { sale: SaleWorkspaceRecord; review: Review; proposalKey: string; fingerprint: string };
export type SaleReturnReplaceProps = {
  sale: SaleWorkspaceRecord;
  cars: StockCar[];
  onSaved: (sale: SaleWorkspaceRecord) => void;
  onOpenSale: (id: string) => void;
  disabled?: boolean;
  canReturn?: boolean;
  canInspect?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
};
const moneyInput = (amount: number) => (amount / 100).toFixed(2);
const apiError = (error: unknown, fallback: string) => {
  const message = (error as { data?: { error?: unknown } })?.data?.error;
  return typeof message === 'string' ? message : fallback;
};
const validMoney = (value: string) => value.trim().length > 0 && Number.isSafeInteger(saleWorkspacePence(value)) && saleWorkspacePence(value) > 0;
const validMileage = (value: string) => /^\d{1,7}$/.test(value.trim()) && Number(value) <= 2_000_000;

export function SaleReturnReplace({ sale, cars, onSaved, onOpenSale, disabled = false, canReturn = true, canInspect = canReturn, onDirtyChange }: SaleReturnReplaceProps) {
  const id = useId(), [expanded, setExpanded] = useState(false), [search, setSearch] = useState('');
  const [replacementVehicleId, setReplacementVehicleId] = useState(''), [replacementPrice, setReplacementPrice] = useState('');
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  const [agreedCredit, setAgreedCredit] = useState(moneyInput(totals.confirmedPaid)), [reason, setReason] = useState(''), [condition, setCondition] = useState(''), [mileage, setMileage] = useState(''), [financeConfirmed, setFinanceConfirmed] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [reviewed, setReviewed] = useState<ReviewedProposal | null>(null), [busy, setBusy] = useState<'review' | 'confirm' | 'override' | null>(null), [error, setError] = useState('');
  const [overrideOpen, setOverrideOpen] = useState(false), [overrideReason, setOverrideReason] = useState(''), [overrideConfirmed, setOverrideConfirmed] = useState(false);
  const lock = useRef(false), generation = useRef(0), retry = useRef(new Map<string, string>());
  const latest = useRef({ sale, disabled }); latest.current = { sale, disabled };
  const effectiveSale = reviewed?.sale.id === sale.id && reviewed.sale.revision >= sale.revision ? reviewed.sale : sale;
  const eligibleCars = cars.filter(car => car.id !== sale.draft.vehicleId && car.inventoryStatus === 'available' && car.sourceStatus !== 'missing' && !car.archivedAt && Number(car.missingCount ?? 0) === 0);
  const selected = eligibleCars.find(car => car.id === replacementVehicleId);
  const query = search.toLocaleLowerCase('en-GB').replace(/\s/g, '');
  const matches = eligibleCars.filter(car => `${vehicleDisplayTitle(car)} ${vehicleRegistration(car)} ${car.year ?? ''} ${car.colour ?? ''}`.toLocaleLowerCase('en-GB').replace(/\s/g, '').includes(query));
  const proposal: Proposal = { replacementVehicleId, replacementPrice, agreedCredit, reason: reason.trim(), condition: condition.trim(), mileage: Number(mileage), financeConfirmed, acknowledge: true };
  const fingerprint = JSON.stringify(proposal), reviewCurrent = reviewed?.fingerprint === fingerprint && reviewed.sale.revision === effectiveSale.revision && !disabled;
  const reviewPassed = reviewCurrent && (reviewed?.review.status === 'passed' || reviewed?.review.status === 'overridden');
  const invalid = !selected ? 'Choose an available replacement car.' : !validMoney(replacementPrice) ? 'Enter the agreed replacement price with up to two decimal places.' : !validMoney(agreedCredit) || saleWorkspacePence(agreedCredit) > totals.confirmedPaid ? 'Enter return credit up to the net funds held on this sale.' : !validMileage(mileage) ? 'Enter the returned vehicle mileage.' : !reason.trim() ? 'Add the reason for the return.' : !condition.trim() ? 'Record the returned vehicle condition.' : !financeConfirmed ? 'Confirm finance and third-party settlement is resolved.' : '';
  const difference = validMoney(replacementPrice) && validMoney(agreedCredit) ? saleWorkspacePence(replacementPrice) - saleWorkspacePence(agreedCredit) : null;
  const hasDraft = !!sale.completedAt && sale.lifecycle?.status === 'sold' && sale.returnReplacement?.direction !== 'returned' && !!(replacementVehicleId || search || reason || condition || mileage || financeConfirmed || agreedCredit !== moneyInput(totals.confirmedPaid));
  useEffect(() => { onDirtyChange?.(hasDraft); return () => onDirtyChange?.(false); }, [hasDraft, onDirtyChange]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (hasDraft || lock.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [hasDraft]);
  useEffect(() => { setAcknowledged(false); }, [fingerprint, sale.revision, disabled]);
  useEffect(() => () => { generation.current++; }, [sale.id]);
  function requestId(key: string) { if (!retry.current.has(key)) retry.current.set(key, requestUuid()); return retry.current.get(key)!; }
  async function runReview() {
    if (lock.current || disabled || !canReturn) return;
    if (invalid) { setError(invalid); return; }
    const requested = { id: sale.id, revision: effectiveSale.revision, fingerprint, proposal }, token = generation.current;
    const key = JSON.stringify(['review', requested.id, requested.revision, requested.fingerprint]);
    lock.current = true; setBusy('review'); setError(''); setAcknowledged(false);
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord; review: Review; proposalKey: string }>(`/api/sale-operations/${requested.id}/replacement-review`, { method: 'POST', body: JSON.stringify({ ...requested.proposal, expectedRevision: requested.revision, requestId: requestId(key) }) });
      if (token !== generation.current || latest.current.sale.id !== requested.id) return;
      if (latest.current.disabled || (latest.current.sale.revision !== sale.revision && latest.current.sale.revision !== requested.revision)) { setError('The deal changed while the proposed exchange was checked. Save any changes and check the proposal again.'); return; }
      if (result.sale?.id !== requested.id || !Number.isSafeInteger(result.sale.revision) || result.sale.revision < requested.revision || !result.proposalKey || !result.review || !['passed', 'attention', 'unavailable', 'overridden'].includes(result.review.status) || !Array.isArray(result.review.issues) || typeof result.review.summary !== 'string' || result.review.reviewedRevision !== result.sale.revision) throw new Error('Invalid exchange review result');
      retry.current.delete(key); setReviewed({ ...result, fingerprint: requested.fingerprint }); onSaved(result.sale);
    } catch (err) { if (token === generation.current) setError(apiError(err, 'The proposed exchange could not be checked. Your entries are kept. Try again.')); }
    finally { if (token === generation.current) { lock.current = false; setBusy(null); } }
  }
  async function override() {
    if (lock.current || disabled || !canReturn || invalid || overrideReason.trim().length < 3 || !overrideConfirmed) return;
    const requested = { id: sale.id, revision: effectiveSale.revision, fingerprint, proposal }, token = generation.current;
    const key = JSON.stringify(['override', requested.id, requested.revision, requested.fingerprint, overrideReason.trim()]);
    lock.current = true; setBusy('override'); setError(''); setAcknowledged(false);
    try {
      const result = await customFetch<{sale:SaleWorkspaceRecord;review:Review;proposalKey:string}>(`/api/sale-operations/${requested.id}/override-replacement-review`, {method:'POST',body:JSON.stringify({...requested.proposal,expectedRevision:requested.revision,requestId:requestId(key),overrideReason:overrideReason.trim(),confirm:true})});
      if (token !== generation.current || latest.current.sale.id !== requested.id) return;
      if (latest.current.disabled || (latest.current.sale.revision !== sale.revision && latest.current.sale.revision !== requested.revision)) {setError('The deal changed. Your entries are kept. Review the saved deal before using an override.');return;}
      if (result.sale?.id !== requested.id || !Number.isSafeInteger(result.sale.revision) || result.sale.revision <= requested.revision || result.review?.status !== 'overridden' || !result.review.override || !result.proposalKey || result.review.reviewedRevision !== result.sale.revision || !Array.isArray(result.review.issues)) throw Error('Invalid staff override');
      retry.current.delete(key);setReviewed({...result,fingerprint:requested.fingerprint});setOverrideOpen(false);setOverrideConfirmed(false);onSaved(result.sale);
    } catch(err) {if(token === generation.current)setError(apiError(err,'The staff override could not be saved. Your entries are kept. Try again.'));}
    finally {if(token === generation.current){lock.current=false;setBusy(null);}}
  }
  async function confirm() {
    if (lock.current || disabled || !canReturn || !reviewPassed || !acknowledged || invalid || !reviewed) return;
    const requested = { id: effectiveSale.id, revision: effectiveSale.revision, fingerprint, proposalKey: reviewed.proposalKey, proposal }, token = generation.current;
    const key = JSON.stringify(['confirm', requested.id, requested.revision, requested.fingerprint, requested.proposalKey]);
    lock.current = true; setBusy('confirm'); setError('');
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord; replacementId: string }>(`/api/sale-operations/${requested.id}/return-replace`, { method: 'POST', body: JSON.stringify({ ...requested.proposal, proposalKey: requested.proposalKey, expectedRevision: requested.revision, requestId: requestId(key) }) });
      if (token !== generation.current || latest.current.sale.id !== requested.id) return;
      if (!result.replacementId || result.sale?.id !== requested.id || result.sale.returnReplacement?.direction !== 'returned' || result.sale.returnReplacement.otherSaleId !== result.replacementId) throw new Error('Invalid replacement result');
      if (latest.current.disabled || latest.current.sale.revision > result.sale.revision) { setError('The exchange was saved. Keep your unsaved entries and reload this deal to open its replacement.'); return; }
      setExpanded(false); onDirtyChange?.(false); onSaved(result.sale);
    } catch (err) { if (token === generation.current) { if ((err as {status?:number})?.status === 409) { setReviewed(null); setAcknowledged(false); } setError(apiError(err, 'The exchange could not be confirmed. If the connection was lost, retry with the same details to recover its saved result.')); } }
    finally { if (token === generation.current) { lock.current = false; setBusy(null); } }
  }
  if (sale.returnReplacement?.direction === 'returned' || (sale.returnReplacement?.direction === 'replacement' && !sale.completedAt)) {
    const returned = sale.returnReplacement.direction === 'returned';
    return <><section className="sale-desk-sheet sale-return" aria-label={returned ? 'Returned vehicle' : 'Replacement vehicle'}><h3><RefreshCw size={18} aria-hidden="true"/>{returned ? 'Vehicle returned' : 'Replacement deal'}</h3><p>{returned ? sale.returnInspection ? 'The original invoice and received payments are kept. The return inspection has been recorded.' : 'The original invoice and received payments are kept. The returned car is awaiting inspection.' : 'This deal includes credit from the customer’s original purchase.'}</p><dl className="sale-return-link-summary"><div><dt>{returned ? 'Credit transferred to replacement' : 'Credit from original sale'}</dt><dd>{saleMoney(sale.returnReplacement.creditPence)}</dd></div></dl><Button type="button" variant="outline" disabled={disabled || !!busy} onClick={() => onOpenSale(sale.returnReplacement!.otherSaleId)}>{returned ? 'Open replacement' : 'Open original sale'} {sale.returnReplacement.otherReference}<ArrowRight size={16} aria-hidden="true"/></Button></section>{returned && <div className="sale-return"><SaleReturnInspection sale={sale} onChange={onSaved} disabled={disabled || !!busy} canInspect={canInspect}/></div>}</>;
  }
  if (!sale.completedAt || sale.lifecycle?.status !== 'sold') return null;
  const blocked = totals.balance !== 0 || totals.pending !== 0 ? 'Settle the original balance and pending payments before returning this car.' : sale.draft.partExchange || !!sale.draft.exchanges?.length ? 'This sale includes part-exchange property. A manager must resolve its return and finance settlement first.' : Object.keys(sale.providerPayments ?? {}).length ? 'This sale has provider-managed funds. Resolve that settlement before transferring credit.' : '';
  return <section className="sale-desk-sheet sale-return" aria-label="Return and replace" aria-busy={!!busy}>
    <div className="sale-return-heading"><div><h3><RefreshCw size={18} aria-hidden="true"/>Return & replace</h3><p>Take this car back and move the agreed credit to another vehicle.</p></div><Button type="button" variant="outline" aria-expanded={expanded} aria-controls={`${id}-form`} disabled={!!busy || disabled || !canReturn || !!blocked} onClick={() => setExpanded(value => !value)}>{expanded ? 'Fold details' : 'Return & replace'}</Button></div>
    {sale.returnReplacement?.direction === 'replacement' && <div className="sale-return-previous"><p>This purchase includes {saleMoney(sale.returnReplacement.creditPence)} credit from {sale.returnReplacement.otherReference}. Its history stays linked.</p><Button type="button" variant="outline" size="sm" disabled={disabled || !!busy} onClick={() => onOpenSale(sale.returnReplacement!.otherSaleId)}>Open original sale<ArrowRight size={16} aria-hidden="true"/></Button></div>}
    {disabled && <p>Save the current deal and any received payment before starting a return.</p>}{!canReturn && <p>A staff member with sale and refund permissions must confirm this exchange.</p>}{blocked && <p role="status">{blocked}</p>}
    {expanded && <div id={`${id}-form`}>
      <fieldset disabled={!!busy || disabled || !canReturn || !!blocked} className="sale-return-fields"><legend className="sr-only">Proposed vehicle exchange</legend>
        <label htmlFor={selected ? undefined : `${id}-search`}>Replacement car</label>
        {selected ? <div className="sale-return-selected"><span><strong>{vehicleDisplayTitle(selected)}</strong><small>{vehicleRegistration(selected)}{selected.year ? ` · ${selected.year}` : ''}</small></span><Button type="button" variant="outline" onClick={() => { setReplacementVehicleId(''); setReplacementPrice(''); setSearch(''); }}>Change car</Button></div> : <><div className="sale-return-search"><Search size={18} aria-hidden="true"/><Input id={`${id}-search`} value={search} placeholder="Search make, model or registration" onChange={event => setSearch(event.target.value)}/></div><p className="sale-return-result-count" role="status">{matches.length ? `${matches.length} available ${matches.length === 1 ? 'car' : 'cars'}${matches.length > 5 ? ' · Search to narrow the list' : ''}` : 'No available cars match. Try another make or registration.'}</p><ul className="sale-return-cars" aria-label="Available replacement cars">{matches.slice(0, 5).map(car => <li key={car.id}><button type="button" onClick={() => { setReplacementVehicleId(car.id); setReplacementPrice(typeof car.price === 'number' && car.price > 0 ? car.price.toFixed(2) : ''); }}><span><strong>{vehicleDisplayTitle(car)}</strong><small>{vehicleRegistration(car)}{car.year ? ` · ${car.year}` : ''}</small></span><span>{typeof car.price === 'number' ? saleMoney(Math.round(car.price * 100)) : 'Set agreed price'}</span><ArrowRight size={16} aria-hidden="true"/></button></li>)}</ul></>}
        <div className="sale-return-grid"><label>Agreed replacement price (£)<Input inputMode="decimal" value={replacementPrice} onChange={event => setReplacementPrice(event.target.value)} maxLength={16}/></label><label>Agreed return credit (£)<Input inputMode="decimal" value={agreedCredit} onChange={event => setAgreedCredit(event.target.value)} maxLength={16}/><small>Net funds held: {saleMoney(totals.confirmedPaid)}</small></label></div>
        <p>New delivery charges or extras can be agreed in the replacement deal. They are not included in this comparison.</p>
        {difference !== null && <dl className="sale-return-comparison" aria-label="Replacement comparison"><div><dt>Replacement vehicle</dt><dd>{saleMoney(saleWorkspacePence(replacementPrice))}</dd></div><div><dt>Credit transferred</dt><dd>−{saleMoney(saleWorkspacePence(agreedCredit))}</dd></div><div data-balance={difference === 0 ? 'settled' : difference < 0 ? 'credit' : 'outstanding'}><dt>{difference < 0 ? 'Refund due to customer' : difference > 0 ? 'Extra amount to pay' : 'Nothing further to pay'}</dt><dd>{saleMoney(Math.abs(difference))}</dd></div></dl>}
        <div className="sale-return-grid"><label>Returned mileage (miles)<Input inputMode="numeric" value={mileage} onChange={event => setMileage(event.target.value)} maxLength={7}/></label><label>Reason for return<Textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} maxLength={2000}/></label></div>
        <label>Returned vehicle condition<Textarea rows={2} value={condition} placeholder="Condition, damage, keys and documents received" onChange={event => setCondition(event.target.value)} maxLength={4000}/></label>
        <label className="sale-return-check"><input type="checkbox" checked={financeConfirmed} onChange={event => setFinanceConfirmed(event.target.checked)}/><span>Finance and any third-party settlement have been resolved.</span></label>
      </fieldset>
      <div className="sale-return-review" data-status={reviewCurrent ? reviewed.review.status : 'ready'} aria-live="polite"><h4>{busy === 'review' ? <><LoaderCircle size={18} className="sale-return-spinner" aria-hidden="true"/>Please wait while AI checks the proposed exchange…</> : reviewCurrent ? reviewed.review.status === 'passed' || reviewed.review.status === 'overridden' ? <><CheckCircle2 size={18} aria-hidden="true"/>{reviewed.review.status === 'overridden' ? 'Staff override recorded' : 'Exchange checks passed'}</> : <><AlertCircle size={18} aria-hidden="true"/>{reviewed.review.status === 'attention' ? 'The exchange needs attention' : 'Exchange check unavailable'}</> : reviewed ? 'The proposal changed. Check it again.' : 'Check the proposed exchange'}</h4><p>{reviewCurrent ? reviewed.review.summary : 'Checks the return credit, replacement price and saved agreement before either sale is changed.'}</p>{reviewCurrent && reviewed.review.override && <p>Recorded by {reviewed.review.override.actor}: {reviewed.review.override.reason}</p>}{reviewCurrent && reviewed.review.override?.ignoredReview && <details><summary>AI advice overridden</summary><p>{reviewed.review.override.ignoredReview.summary}</p>{reviewed.review.override.ignoredReview.model && <p>Model: {reviewed.review.override.ignoredReview.model}</p>}</details>}{reviewCurrent && reviewed.review.issues.length > 0 && <ul>{reviewed.review.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}</div>
      {!reviewPassed && <div className="sale-return-review-actions"><Button type="button" variant="outline" disabled={!!busy || disabled || !canReturn || !!blocked} onClick={() => void runReview()}>{busy === 'review' ? 'Checking exchange…' : reviewed || error ? 'Check exchange again' : 'Check proposed exchange'}</Button><Button type="button" variant="ghost" disabled={!!busy || disabled || !canReturn || !!invalid || !!blocked} onClick={() => { setOverrideConfirmed(false);setOverrideOpen(true);setError(''); }}>{reviewed?.review.status === 'attention' ? 'Override AI check' : 'Continue without AI'}</Button></div>}
      {reviewPassed && <><label className="sale-return-check"><input type="checkbox" checked={acknowledged} disabled={!!busy || disabled} onChange={event => setAcknowledged(event.target.checked)}/><span>I confirm the customer’s agreed return and {saleMoney(saleWorkspacePence(agreedCredit))} credit transfer. The replacement will be reserved and the returned car held for inspection.</span></label><p>No cash is refunded by this action. Record any refund on the replacement deal after paying the customer.</p><Button type="button" disabled={!!busy || disabled || !acknowledged || !canReturn || !!invalid} onClick={() => void confirm()}>{busy === 'confirm' ? 'Saving replacement…' : 'Confirm return & create replacement'}</Button></>}
      {error && !overrideOpen && <p className="sale-return-error" role="alert">{error}</p>}
      <Dialog open={overrideOpen} onOpenChange={value => { if (!busy) setOverrideOpen(value); }}><DialogContent className="sale-return-override-dialog"><DialogTitle>Continue without AI approval?</DialogTitle><DialogDescription>Staff must check this proposed exchange. Financial, stock and credit safeguards still apply. This decision is saved in the sale history.</DialogDescription><label>Reason for staff override<Textarea rows={3} value={overrideReason} disabled={!!busy} maxLength={2000} onChange={event => {setOverrideReason(event.target.value);setOverrideConfirmed(false);}}/></label><label className="sale-return-check"><input type="checkbox" checked={overrideConfirmed} disabled={!!busy} onChange={event => setOverrideConfirmed(event.target.checked)}/><span>I have checked the exchange and want to continue without AI approval.</span></label>{error && <p role="alert" className="sale-return-error">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={!!busy} onClick={() => setOverrideOpen(false)}>Keep reviewing</Button><Button type="button" disabled={!!busy || !overrideConfirmed || overrideReason.trim().length < 3 || disabled || !!invalid} onClick={() => void override()}>{busy === 'override' ? 'Saving override…' : 'Record staff override'}</Button></DialogFooter></DialogContent></Dialog>
    </div>}
  </section>;
}

export function SaleReplacementRefund({ sale, onSaved, disabled = false, onDirtyChange }: { sale: SaleWorkspaceRecord; onSaved: (sale: SaleWorkspaceRecord) => void; disabled?: boolean; onDirtyChange?: (dirty: boolean) => void }) {
  const totals = saleWorkspaceTotals(sale.draft, sale.payments), availableCredit = Math.max(0, -totals.balance);
  const [expanded, setExpanded] = useState(false), [amount, setAmount] = useState(moneyInput(availableCredit)), [method, setMethod] = useState('Bank transfer'), [date, setDate] = useState(todayLondon()), [received, setReceived] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), retry = useRef(new Map<string, string>()), generation = useRef(0), latest = useRef({ sale, disabled }); latest.current = { sale, disabled };
  useEffect(() => () => { generation.current++; }, [sale.id]);
  useEffect(() => { setReceived(false); }, [sale.revision]);
  useEffect(() => { setAmount(moneyInput(availableCredit)); }, [availableCredit]);
  const refundDirty = sale.returnReplacement?.direction === 'replacement' && availableCredit > 0 && (received || amount !== moneyInput(availableCredit) || method !== 'Bank transfer' || date !== todayLondon());
  useEffect(() => { onDirtyChange?.(refundDirty); return () => onDirtyChange?.(false); }, [refundDirty, onDirtyChange]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (refundDirty || lock.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [refundDirty]);
  if (sale.returnReplacement?.direction !== 'replacement' || availableCredit === 0) return null;
  const parsed = saleWorkspacePence(amount), invalidAmount = !validMoney(amount) || parsed > availableCredit;
  async function save() {
    if (lock.current || disabled || !received || invalidAmount || !method.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayLondon()) return;
    const key = JSON.stringify([sale.id, sale.revision, amount, method, date]), token = generation.current;
    if (!retry.current.has(key)) retry.current.set(key, requestUuid());
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-operations/${sale.id}/refund-credit`, { method: 'POST', body: JSON.stringify({ amount, method, date, confirmReceived: true, expectedRevision: sale.revision, requestId: retry.current.get(key) }) });
      if (token !== generation.current || latest.current.sale.id !== sale.id) return;
      if (latest.current.disabled || latest.current.sale.revision !== sale.revision) { setError('The refund may have been saved. Your current edits are kept. Reload the saved deal before recording another refund.'); return; }
      if (result.sale?.id !== sale.id || result.sale.revision <= sale.revision || !Array.isArray(result.sale.payments)) throw new Error('Invalid refund result');
      setExpanded(false); setReceived(false); onSaved(result.sale);
    } catch (err) { if (token === generation.current) setError(apiError(err, 'The refund result could not be confirmed. Retry with the same details to recover the saved result.')); }
    finally { if (token === generation.current) { lock.current = false; setBusy(false); } }
  }
  return <section className="sale-desk-sheet sale-return sale-return-refund" aria-label="Refund remaining credit" aria-busy={busy}><div className="sale-return-heading"><div><h3>Customer credit: {saleMoney(availableCredit)}</h3><p>Pay the customer first, then record the refund here.</p></div><Button type="button" variant="outline" disabled={busy || disabled} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Fold refund entry' : 'Record refunded credit'}</Button></div>{expanded && <><fieldset disabled={busy || disabled} className="sale-return-fields"><legend className="sr-only">Refund already paid</legend><div className="sale-return-grid"><label>Refund amount (£)<Input inputMode="decimal" maxLength={16} value={amount} onChange={event => { setAmount(event.target.value); setReceived(false); }}/></label><label>Refund method<select value={method} onChange={event => { setMethod(event.target.value); setReceived(false); }}><option>Bank transfer</option><option>Cash</option><option>Card refund</option><option>Other confirmed method</option></select></label><label>Actual refund date<Input type="date" max={todayLondon()} value={date} onChange={event => { setDate(event.target.value); setReceived(false); }}/></label></div><label className="sale-return-check"><input type="checkbox" checked={received} onChange={event => setReceived(event.target.checked)}/><span>I have checked that this refund has actually been paid to the customer.</span></label><p>This records a completed refund. It does not send a bank transfer or initiate a card refund.</p></fieldset><Button type="button" disabled={busy || disabled || invalidAmount || !received || !date || date > todayLondon()} onClick={() => void save()}>{busy ? 'Recording refund…' : 'Record confirmed refund'}</Button>{invalidAmount && <p role="alert">Enter an amount up to the remaining {saleMoney(availableCredit)} credit.</p>}</>}{error && <p role="alert" className="sale-return-error">{error}</p>}</section>;
}
