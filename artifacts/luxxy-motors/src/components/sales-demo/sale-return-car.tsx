import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { saleCalendarDate, saleWorkspacePence, saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { requestUuid } from '@/lib/request-uuid';
import { RefreshCw } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { saleMoney, todayLondon } from './sales-controls';
import { SaleReturnInspection } from './sale-return-inspection';
import './sale-return-replace.css';

export type SaleReturnCarProps = {
  sale: SaleWorkspaceRecord; onSaved: (sale: SaleWorkspaceRecord) => void; disabled?: boolean;
  canReturn?: boolean; canInspect?: boolean; onDirtyChange?: (dirty: boolean) => void;
  initialExpanded?: boolean; onRefund?: () => void; onBusyChange?: (busy: boolean) => void;
};
const moneyInput = (pence: number) => (pence / 100).toFixed(2);
/** Return the vehicle agreement, not a fictional payment/refund or a second sale. */
export function SaleReturnCar({ sale, onSaved, disabled = false, canReturn = true, canInspect = canReturn, onDirtyChange, initialExpanded = false, onRefund, onBusyChange }: SaleReturnCarProps) {
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  const [expanded, setExpanded] = useState(initialExpanded), [credit, setCredit] = useState(moneyInput(totals.totalDue)), [mileage, setMileage] = useState(''), [returnedDate, setReturnedDate] = useState(todayLondon());
  const [reason, setReason] = useState(''), [condition, setCondition] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), generation = useRef(0), retry = useRef<{key:string;id:string}|undefined>(undefined), latest = useRef({sale,disabled}); latest.current = {sale,disabled};
  const amount = saleWorkspacePence(credit), validAmount = !!credit.trim() && Number.isSafeInteger(amount) && amount > 0 && amount <= totals.totalDue && amount >= Math.max(0,totals.balance);
  const refundDue = validAmount ? Math.max(0, totals.confirmedPaid - (totals.totalDue - amount)) : 0, unpaidCancelled = validAmount ? Math.min(amount, Math.max(0,totals.balance)) : 0;
  const blocked = totals.pending !== 0 ? 'Resolve pending payments first.' : sale.draft.partExchange || !!sale.draft.exchanges?.length ? 'A manager must resolve the part-exchange property and finance settlement before this return.' : Object.keys(sale.providerPayments ?? {}).length ? 'Resolve provider-managed funds with the provider before this return.' : '';
  const completedDate = sale.completedAt ? saleCalendarDate(sale.completedAt) : '';
  const invalid = !validAmount ? 'Enter agreed return credit up to the original total, clearing any unpaid balance.' : !/^\d{1,7}$/.test(mileage.trim()) || Number(mileage) > 2_000_000 ? 'Enter the returned vehicle mileage.' : !reason.trim() || !condition.trim() ? 'Record the return reason and condition.' : !/^\d{4}-\d{2}-\d{2}$/.test(returnedDate) || returnedDate > todayLondon() || returnedDate < completedDate ? 'Choose the actual return date, between the completed sale and today.' : '';
  const dirty = !sale.standaloneReturn && sale.lifecycle?.status === 'sold' && !!(mileage || reason || condition || confirmed || credit !== moneyInput(totals.totalDue) || returnedDate !== todayLondon());
  useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false); }, [busy,onBusyChange]);
  const fingerprint = JSON.stringify([credit,mileage,returnedDate,reason,condition,sale.revision,disabled]);
  useEffect(() => { setConfirmed(false); }, [fingerprint]);
  useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty,onDirtyChange]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => {if(dirty || lock.current){event.preventDefault();event.returnValue='';}}; window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn); }, [dirty]);
  useEffect(() => () => {generation.current++;},[sale.id]);
  async function confirmReturn() {
    if(lock.current || disabled || !canReturn || !confirmed || invalid || blocked) return;
    const proposal = {agreedCredit:credit,reason:reason.trim(),condition:condition.trim(),mileage:Number(mileage),returnedDate,financeConfirmed:true,received:true,acknowledge:true};
    const request = {id:sale.id,revision:sale.revision}, key=JSON.stringify([request,proposal]), token=generation.current;
    if(retry.current?.key!==key)retry.current={key,id:requestUuid()};
    lock.current=true;setBusy(true);setError('');
    try {
      const result=await customFetch<{sale:SaleWorkspaceRecord}>(`/api/sale-operations/${sale.id}/return-car`,{method:'POST',body:JSON.stringify({...proposal,expectedRevision:request.revision,requestId:retry.current.id})});
      if(token!==generation.current || latest.current.sale.id!==request.id)return;
      if(result.sale?.id!==request.id || !result.sale.standaloneReturn || result.sale.lifecycle?.status!=='returned' || result.sale.revision<=request.revision)throw Error('Invalid return result');
      if(latest.current.disabled || latest.current.sale.revision!==request.revision){setError('The return was saved. Your current edits are kept. Reload the sale before making another change.');return;}
      setExpanded(false);onDirtyChange?.(false);onSaved(result.sale);
    }catch(failure){if(token===generation.current){const message=(failure as {data?:{error?:unknown}})?.data?.error;setError(typeof message==='string'?message:'The return result could not be confirmed. Keep these details and retry to recover the saved result.');}}
    finally{if(token===generation.current){lock.current=false;setBusy(false);}}
  }
  if(sale.standaloneReturn){
    const returned=sale.standaloneReturn, remainingRefund=Math.max(0,-totals.balance);
    return <div className="sale-return"><section className="sale-desk-sheet" aria-label="Returned car"><h3><RefreshCw size={18}/>Car returned</h3><p>{sale.draft.vehicle} · {sale.draft.registration}. Original invoices and receipts stay saved.</p><dl className="sale-return-comparison"><div><dt>Agreed return credit</dt><dd>{saleMoney(returned.creditPence)}</dd></div>{returned.unpaidCancelledPence>0&&<div><dt>Original unpaid balance cancelled</dt><dd>{saleMoney(returned.unpaidCancelledPence)}</dd></div>}<div><dt>{remainingRefund>0?'Refund still due':'Refund balance'}</dt><dd>{saleMoney(remainingRefund)}</dd></div></dl>{remainingRefund>0&&<><p>Pay the customer first, then record the actual refund.</p>{onRefund&&<Button onClick={onRefund} disabled={disabled||!canReturn}>Record refund</Button>}</>}<details><summary>Return details</summary><p>{returned.returnedDate} · {returned.mileage.toLocaleString('en-GB')} miles</p><p>{returned.reason}</p><p>{returned.condition}</p></details></section><SaleReturnInspection sale={sale} onChange={onSaved} disabled={disabled} canInspect={canInspect}/></div>;
  }
  if(!sale.completedAt||sale.lifecycle?.status!=='sold'||sale.returnReplacement?.direction==='returned')return null;
  return <section className="sale-desk-sheet sale-return" aria-label="Return car" aria-busy={busy}><div className="sale-return-heading"><div><h3><RefreshCw size={18}/>Return car</h3><p>Take the car back without a replacement.</p></div><Button variant="outline" type="button" disabled={disabled||busy||!canReturn||!!blocked} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Fold return details':'Return car'}</Button></div>
    {blocked&&<p role="status">{blocked}</p>}{!canReturn&&<p>A staff member with sale and refund permissions must confirm this return.</p>}{disabled&&<p>Save the current deal and any received payment first.</p>}
    {expanded&&<><fieldset className="sale-return-fields" disabled={disabled||busy||!canReturn||!!blocked}><legend className="sr-only">Vehicle return agreement</legend><div className="sale-return-grid"><label>Agreed return credit (£)<Input aria-label="Agreed return credit (£)" inputMode="decimal" value={credit} maxLength={16} onChange={event=>setCredit(event.target.value)}/><small>Credit against the original {saleMoney(totals.totalDue)} agreement, including any unpaid amount.</small></label><label>Returned mileage (miles)<Input inputMode="numeric" value={mileage} maxLength={7} onChange={event=>setMileage(event.target.value)}/></label><label>Actual return date<Input type="date" min={completedDate} max={todayLondon()} value={returnedDate} onChange={event=>setReturnedDate(event.target.value)}/></label><label>Reason for return<Textarea rows={2} value={reason} maxLength={2000} onChange={event=>setReason(event.target.value)}/></label></div><label>Returned vehicle condition<Textarea rows={2} value={condition} maxLength={4000} placeholder="Condition, mileage, keys and documents received" onChange={event=>setCondition(event.target.value)}/></label>
    {credit.trim()&&!validAmount&&<p className="sale-return-error" role="alert">Enter credit from {saleMoney(Math.max(1,totals.balance))} to {saleMoney(totals.totalDue)} so the original unpaid amount is settled.</p>}
    {validAmount&&<dl className="sale-return-comparison" aria-label="Return amounts"><div><dt>Recorded funds held</dt><dd>{saleMoney(totals.confirmedPaid)}</dd></div><div><dt>Unpaid balance cancelled</dt><dd>{saleMoney(unpaidCancelled)}</dd></div><div><dt>Refund due to customer</dt><dd>{saleMoney(refundDue)}</dd></div></dl>}
    <label className="sale-return-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>I confirm the car is back, the customer agreed this credit, and finance or third-party settlement is resolved.</span></label></fieldset><p>This saves a return credit note and holds the car off sale for inspection. It does not send a refund.</p><Button type="button" disabled={disabled||busy||!canReturn||!!blocked||!!invalid||!confirmed} onClick={()=>void confirmReturn()}>{busy?'Saving return…':'Confirm vehicle return'}</Button>{error&&<p className="sale-return-error" role="alert">{error}</p>}</>}
  </section>;
}
