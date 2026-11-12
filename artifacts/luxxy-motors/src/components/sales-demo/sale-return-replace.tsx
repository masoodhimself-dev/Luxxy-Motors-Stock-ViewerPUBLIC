import { useEffect, useId, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { saleWorkspacePence, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import type { Car as StockCar } from '@/lib/stock-context';
import { vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { requestUuid } from '@/lib/request-uuid';
import { ArrowRight, RefreshCw, Search } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saleMoney, todayLondon } from './sales-controls';
import { SaleReturnInspection } from './sale-return-inspection';
import './sale-return-replace.css';

export type SaleReturnReplaceProps = {
  sale: SaleWorkspaceRecord; cars: StockCar[]; onSaved: (sale: SaleWorkspaceRecord) => void;
  onOpenSale: (id: string) => void; disabled?: boolean; canReturn?: boolean; canInspect?: boolean;
  onDirtyChange?: (dirty: boolean) => void; initialExpanded?: boolean; onBusyChange?: (busy: boolean) => void;
};
const moneyInput = (amount: number) => (amount / 100).toFixed(2);
const apiError = (error: unknown, fallback: string) => {
  const message = (error as { data?: { error?: unknown } })?.data?.error;
  return typeof message === 'string' ? message : fallback;
};
const validMoney = (value: string) => value.trim().length > 0 && Number.isSafeInteger(saleWorkspacePence(value)) && saleWorkspacePence(value) > 0;
const validMileage = (value: string) => /^\d{1,7}$/.test(value.trim()) && Number(value) <= 2_000_000;

export function SaleReturnReplace({ sale, cars, onSaved, onOpenSale, disabled = false, canReturn = true, canInspect = canReturn, onDirtyChange, initialExpanded = false, onBusyChange }: SaleReturnReplaceProps) {
  const id = useId(), [expanded, setExpanded] = useState(initialExpanded), [search, setSearch] = useState('');
  const [replacementVehicleId, setReplacementVehicleId] = useState(''), [replacementPrice, setReplacementPrice] = useState('');
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  const [agreedCredit, setAgreedCredit] = useState(moneyInput(totals.confirmedPaid)), [reason, setReason] = useState(''), [condition, setCondition] = useState(''), [mileage, setMileage] = useState('');
  const [financeConfirmed, setFinanceConfirmed] = useState(false), [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [availability, setAvailability] = useState<{ key: string; error: string }>();
  const [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const lock = useRef(false), generation = useRef(0), retry = useRef<{key:string;id:string}|undefined>(undefined);
  const latest = useRef({ sale, disabled }); latest.current = { sale, disabled };
  const eligibleCars = cars.filter(car => car.id !== sale.draft.vehicleId && car.inventoryStatus === 'available' && car.sourceStatus !== 'missing' && !car.archivedAt && Number(car.missingCount ?? 0) === 0);
  const selected = eligibleCars.find(car => car.id === replacementVehicleId), query = search.toLocaleLowerCase('en-GB').replace(/\s/g, '');
  const selectedId = selected?.id;
  const availabilityKey = selectedId ? `${sale.id}:${sale.revision}:${selectedId}:${availabilityAttempt}` : '';
  const availabilityChecked = Boolean(availabilityKey && availability?.key === availabilityKey);
  const availabilityError = availabilityChecked ? availability?.error : '';
  useEffect(() => {
    if (!expanded || !selectedId || !canReturn || disabled || !availabilityKey || sale.lifecycle?.status !== 'sold') return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await customFetch<{ vehicleId: string }>(`/api/sale-operations/${encodeURIComponent(sale.id)}/replacement-availability?vehicleId=${encodeURIComponent(selectedId)}`, { signal: controller.signal });
        if (result.vehicleId !== selectedId) throw new Error('Mismatched replacement car');
        if (!controller.signal.aborted) setAvailability({ key: availabilityKey, error: '' });
      } catch (failure) {
        if (!controller.signal.aborted) setAvailability({ key: availabilityKey, error: apiError(failure, 'Could not check availability. Please try again.') });
      }
    })();
    return () => controller.abort();
  }, [availabilityKey, canReturn, disabled, expanded, sale.id, sale.lifecycle?.status, selectedId]);
  const matches = eligibleCars.filter(car => `${vehicleDisplayTitle(car)} ${vehicleRegistration(car)} ${car.year ?? ''} ${car.colour ?? ''}`.toLocaleLowerCase('en-GB').replace(/\s/g, '').includes(query));
  const proposal = { replacementVehicleId, replacementPrice, agreedCredit, reason: reason.trim(), condition: condition.trim(), mileage: Number(mileage), financeConfirmed, acknowledge: true };
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy,onBusyChange]);
  const fingerprint = JSON.stringify(proposal);
  const invalid = !selected ? 'Choose an available replacement car.' : !validMoney(replacementPrice) ? 'Enter the agreed replacement price with up to two decimal places.' : !validMoney(agreedCredit) || saleWorkspacePence(agreedCredit) > totals.confirmedPaid ? 'Enter return credit up to the net funds held on this sale.' : !validMileage(mileage) ? 'Enter the returned vehicle mileage.' : !reason.trim() ? 'Add the reason for the return.' : !condition.trim() ? 'Record the returned vehicle condition.' : !financeConfirmed ? 'Confirm finance and third-party settlement is resolved.' : '';
  const difference = validMoney(replacementPrice) && validMoney(agreedCredit) ? saleWorkspacePence(replacementPrice) - saleWorkspacePence(agreedCredit) : null;
  const hasDraft = !sale.standaloneReturn && !!sale.completedAt && sale.lifecycle?.status === 'sold' && sale.returnReplacement?.direction !== 'returned' && !!(replacementVehicleId || search || reason || condition || mileage || financeConfirmed || agreedCredit !== moneyInput(totals.confirmedPaid));
  useEffect(() => { onDirtyChange?.(hasDraft); return () => onDirtyChange?.(false); }, [hasDraft, onDirtyChange]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (hasDraft || lock.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [hasDraft]);
  useEffect(() => { setAcknowledged(false); }, [fingerprint, sale.revision, disabled]);
  useEffect(() => () => { generation.current++; }, [sale.id]);
  async function confirm() {
    if (lock.current || disabled || !canReturn || !acknowledged || invalid || !availabilityChecked || availabilityError) return;
    const requested = { id: sale.id, revision: sale.revision, proposal }, token = generation.current, key = JSON.stringify([sale.id, sale.revision, proposal]);
    if (retry.current?.key !== key) retry.current = { key, id: requestUuid() };
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord; replacementId: string }>(`/api/sale-operations/${requested.id}/return-replace`, { method: 'POST', body: JSON.stringify({ ...proposal, expectedRevision: requested.revision, requestId: retry.current.id }) });
      if (token !== generation.current || latest.current.sale.id !== requested.id) return;
      if (!result.replacementId || result.sale?.id !== requested.id || result.sale.returnReplacement?.direction !== 'returned' || result.sale.returnReplacement.otherSaleId !== result.replacementId) throw Error('Invalid replacement result');
      if (latest.current.disabled || latest.current.sale.revision !== requested.revision) { setError('The exchange was saved. Your current edits are kept. Reload the sale before making another change.'); return; }
      setExpanded(false); onDirtyChange?.(false); onSaved(result.sale);
    } catch (failure) { if (token === generation.current) setError(apiError(failure, 'The exchange result could not be confirmed. Keep these details and retry to recover the saved result.')); }
    finally { if (token === generation.current) { lock.current = false; setBusy(false); } }
  }
  if (sale.standaloneReturn) return null;
  if (sale.returnReplacement?.direction === 'returned' || (sale.returnReplacement?.direction === 'replacement' && !sale.completedAt)) {
    const returned = sale.returnReplacement.direction === 'returned';
    return <><section className="sale-desk-sheet sale-return" aria-label={returned ? 'Returned vehicle' : 'Replacement vehicle'}><h3><RefreshCw size={18}/>{returned ? 'Vehicle returned' : 'Replacement deal'}</h3><p>{returned ? sale.returnInspection ? 'The original invoice and payment history are kept. Inspection recorded.' : 'The returned car is held off sale until inspection.' : 'This deal includes credit from the customer’s original purchase.'}</p><dl className="sale-return-link-summary"><div><dt>{returned ? 'Credit transferred to replacement' : 'Credit from original sale'}</dt><dd>{saleMoney(sale.returnReplacement.creditPence)}</dd></div></dl><Button type="button" variant="outline" disabled={disabled || busy} onClick={() => onOpenSale(sale.returnReplacement!.otherSaleId)}>{returned ? 'Open replacement' : 'Open original sale'} {sale.returnReplacement.otherReference}<ArrowRight size={16}/></Button></section>{returned && <div className="sale-return"><SaleReturnInspection sale={sale} onChange={onSaved} disabled={disabled || busy} canInspect={canInspect}/></div>}</>;
  }
  if (!sale.completedAt || sale.lifecycle?.status !== 'sold') return null;
  const blocked = totals.balance !== 0 || totals.pending !== 0 ? 'Settle the original balance and pending payments before transferring credit to another car.' : sale.draft.partExchange || !!sale.draft.exchanges?.length ? 'This sale includes part-exchange property. A manager must resolve its return and finance settlement first.' : Object.keys(sale.providerPayments ?? {}).length ? 'Resolve provider-managed funds with the provider first.' : '';
  return <section className="sale-desk-sheet sale-return" aria-label="Return and replace" aria-busy={busy}>
    <div className="sale-return-heading"><div><h3><RefreshCw size={18}/>Return & replace</h3><p>Return the original car and move agreed credit to another.</p></div><Button type="button" variant="outline" aria-expanded={expanded} aria-controls={`${id}-form`} disabled={busy || disabled || !canReturn || !!blocked} onClick={() => setExpanded(value => !value)}>{expanded ? 'Fold details' : 'Return & replace'}</Button></div>
    {sale.returnReplacement?.direction === 'replacement' && <div className="sale-return-previous"><p>This purchase includes {saleMoney(sale.returnReplacement.creditPence)} from {sale.returnReplacement.otherReference}.</p><Button type="button" variant="outline" size="sm" disabled={disabled || busy} onClick={() => onOpenSale(sale.returnReplacement!.otherSaleId)}>Open original sale<ArrowRight size={16}/></Button></div>}
    {disabled && <p>Save the current deal and any received payment first.</p>}{!canReturn && <p>A staff member with sale and refund permissions must confirm this exchange.</p>}{blocked && <p role="status">{blocked}</p>}
    {expanded && <div id={`${id}-form`}><fieldset disabled={busy || disabled || !canReturn || !!blocked} className="sale-return-fields"><legend className="sr-only">Proposed vehicle exchange</legend>
      <label htmlFor={selected ? undefined : `${id}-search`}>Replacement car</label>
      {selected ? <div className="sale-return-selected"><span><strong>{vehicleDisplayTitle(selected)}</strong><small>{vehicleRegistration(selected)}{selected.year ? ` · ${selected.year}` : ''}</small></span><Button type="button" variant="outline" onClick={() => { setReplacementVehicleId(''); setReplacementPrice(''); setSearch(''); }}>Change car</Button></div> : <><div className="sale-return-search"><Search size={18}/><Input id={`${id}-search`} value={search} placeholder="Search make, model or registration" onChange={event => setSearch(event.target.value)}/></div><p className="sale-return-result-count" role="status">{matches.length ? `${matches.length} available ${matches.length === 1 ? 'car' : 'cars'}${matches.length > 5 ? ' · Search to narrow the list' : ''}` : 'No available cars match. Try another make or registration.'}</p><ul className="sale-return-cars" aria-label="Available replacement cars">{matches.slice(0,5).map(car => <li key={car.id}><button type="button" onClick={() => { setAvailability(undefined);setReplacementVehicleId(car.id);setReplacementPrice(typeof car.price === 'number' && car.price > 0 ? car.price.toFixed(2) : ''); }}><span><strong>{vehicleDisplayTitle(car)}</strong><small>{vehicleRegistration(car)}{car.year ? ` · ${car.year}` : ''}</small></span><span>{typeof car.price === 'number' ? saleMoney(Math.round(car.price*100)) : 'Set agreed price'}</span><ArrowRight size={16}/></button></li>)}</ul></>}
      <div className="sale-return-grid"><label>Agreed replacement price (£)<Input inputMode="decimal" value={replacementPrice} onChange={event => setReplacementPrice(event.target.value)} maxLength={16}/></label><label>Agreed return credit (£)<Input aria-label="Agreed return credit (£)" inputMode="decimal" value={agreedCredit} onChange={event => setAgreedCredit(event.target.value)} maxLength={16}/><small>Net funds held: {saleMoney(totals.confirmedPaid)}</small></label></div>
      {selectedId && !availabilityChecked && !disabled && canReturn && <p role="status">Checking replacement availability…</p>}
      {availabilityError && <div><p className="sale-return-error" role="alert">{availabilityError}</p><Button type="button" variant="outline" size="sm" onClick={() => setAvailabilityAttempt(attempt => attempt + 1)}>Check again</Button></div>}
      {difference !== null && <dl className="sale-return-comparison" aria-label="Replacement comparison"><div><dt>Replacement vehicle</dt><dd>{saleMoney(saleWorkspacePence(replacementPrice))}</dd></div><div><dt>Credit transferred</dt><dd>−{saleMoney(saleWorkspacePence(agreedCredit))}</dd></div><div data-balance={difference === 0 ? 'settled' : difference < 0 ? 'credit' : 'outstanding'}><dt>{difference < 0 ? 'Refund due to customer' : difference > 0 ? 'Extra amount to pay' : 'Nothing further to pay'}</dt><dd>{saleMoney(Math.abs(difference))}</dd></div></dl>}
      <p>New delivery or extras are added to the replacement deal separately.</p>
      <div className="sale-return-grid"><label>Returned mileage (miles)<Input inputMode="numeric" value={mileage} onChange={event => setMileage(event.target.value)} maxLength={7}/></label><label>Reason for return<Textarea rows={2} value={reason} onChange={event => setReason(event.target.value)} maxLength={2000}/></label></div>
      <label>Returned vehicle condition<Textarea rows={2} value={condition} placeholder="Condition, damage, keys and documents received" onChange={event => setCondition(event.target.value)} maxLength={4000}/></label>
      <label className="sale-return-check"><input type="checkbox" checked={financeConfirmed} onChange={event => setFinanceConfirmed(event.target.checked)}/><span>Finance and any third-party settlement have been resolved.</span></label>
      <label className="sale-return-check"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/><span>I confirm the car is back and the customer has agreed this return and credit transfer.</span></label>
    </fieldset><p>The replacement will be reserved. The returned car stays off sale for inspection. No cash refund is sent.</p><Button type="button" disabled={busy || disabled || !canReturn || !!blocked || !!invalid || !acknowledged || !availabilityChecked || Boolean(availabilityError)} onClick={() => void confirm()}>{busy ? 'Saving replacement…' : 'Confirm return & create replacement'}</Button>{error && <p role="alert" className="sale-return-error">{error}</p>}</div>}
  </section>;
}

export function SaleReplacementRefund({ sale, onSaved, disabled = false, onDirtyChange, onBusyChange }: { sale: SaleWorkspaceRecord; onSaved: (sale: SaleWorkspaceRecord) => void; disabled?: boolean; onDirtyChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void }) {
  const totals = saleWorkspaceTotals(sale.draft, sale.payments), availableCredit = Math.max(0, -totals.balance);
  const [expanded, setExpanded] = useState(false), [amount, setAmount] = useState(moneyInput(availableCredit)), [method, setMethod] = useState('Bank transfer'), [date, setDate] = useState(todayLondon()), [received, setReceived] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), retry = useRef(new Map<string, string>()), generation = useRef(0), latest = useRef({ sale, disabled }); latest.current = { sale, disabled };
  useEffect(() => () => { generation.current++; }, [sale.id]);
  useEffect(() => { setReceived(false); }, [sale.revision]);
  useEffect(() => { setAmount(moneyInput(availableCredit)); }, [availableCredit]);
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy,onBusyChange]);
  const refundDirty = (!!sale.standaloneReturn || sale.returnReplacement?.direction === 'replacement') && availableCredit > 0 && (received || amount !== moneyInput(availableCredit) || method !== 'Bank transfer' || date !== todayLondon());
  useEffect(() => { onDirtyChange?.(refundDirty); return () => onDirtyChange?.(false); }, [refundDirty, onDirtyChange]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (refundDirty || lock.current) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [refundDirty]);
  if ((!sale.standaloneReturn && sale.returnReplacement?.direction !== 'replacement') || availableCredit === 0) return null;
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
