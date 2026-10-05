import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Link, useSearch } from 'wouter';
import { HistoryLinks } from './history-links';
import { Button } from '@/components/ui/button';
import { useStaffAccess } from './dealer-administration';
type Record = { id: string; vehicleId: string; reference: string; vehicleTitle: string; vehicleRegistration?: string; customerName: string; email: string; phone: string; depositPence: number; amountReceivedPence: number; amountRefundedPence: number; paymentStatus: string; status: string; mode: 'test'|'live'; needsReview: boolean; saleId?: string };
const money = (pence: number) => new Intl.NumberFormat('en-GB', { style:'currency',currency:'GBP' }).format(pence / 100);
const statuses: { [name: string]: string } = { pending: 'Awaiting payment', refund_pending: 'Refund pending', refund_failed: 'Refund needs review', confirmed: 'Payment confirmed', test_confirmed: 'Test payment · £0 received', partially_refunded: 'Partially refunded', refunded: 'Refunded', cancelled: 'Cancelled' };
export function StripeReservationsPanel() {
  const routeSearch = useSearch();
  const selectedId = new URLSearchParams(routeSearch).get('reservationId');
  const focusedId = useRef<string | null>(null);
  const access = useStaffAccess();
  const query = useQuery({ queryKey: ['stripe-reservations'], queryFn: () => customFetch<{ reservations: Record[] }>('/api/staff/stripe-reservations'), refetchInterval:60000,retry:false });
  const [notice,setNotice] = useState(''),[busy,setBusy] = useState('');
  useEffect(() => {
    if (!selectedId) { focusedId.current = null; return; }
    if (focusedId.current === selectedId || !query.data?.reservations.some(item => item.id === selectedId)) return;
    const frame = requestAnimationFrame(() => { const row = document.getElementById(`reservation-${selectedId}`); if (row) { focusedId.current = selectedId; row.scrollIntoView({ block: 'center' }); row.focus({ preventScroll: true }); } });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, query.data?.reservations]);
  async function resend(id: string) { setBusy(id);setNotice('');try { const result = await customFetch<{ delivery:{status:string} }>(`/api/staff/stripe-reservations/${id}/email`,{method:'POST'});setNotice(result.delivery.status==='sent'?'Reservation email sent.':result.delivery.status==='disabled'?'Email is prepared. Enable Resend in API integrations to send it.':'Email delivery could not be confirmed.');await query.refetch();}catch(error){setNotice(error instanceof Error?error.message:'Email could not be prepared.');}finally{setBusy('');} }
  return <section className="dealer-admin mt-6" aria-label="Card payment reservations"><div className="admin-card"><h2 className="text-xl font-semibold">Card payment reservations</h2><p>Only verified live payments are recorded as money received. Test payments stay separate.</p>{notice&&<p role="status">{notice}</p>}{query.isError?<p role="alert" className="admin-error">Card reservation records could not be loaded.</p>:query.isLoading?<p role="status">Loading card reservations…</p>:!query.data?.reservations.length?<p>No card payment reservations yet. Configure Stripe in API integrations when you are ready.</p>:<ul className="admin-records">{query.data.reservations.map(record=><li key={record.id} id={`reservation-${record.id}`} tabIndex={selectedId === record.id ? -1 : undefined} className={selectedId === record.id ? 'ring-2 ring-inset ring-primary' : undefined}><strong>{record.vehicleTitle} {record.vehicleRegistration && `· ${record.vehicleRegistration}`}</strong><span>{record.reference} · {record.customerName}</span><span>{statuses[record.paymentStatus]??record.paymentStatus} · {record.status.replaceAll('_',' ')}</span><span>{money(record.amountReceivedPence)} received{record.amountRefundedPence>0?` · ${money(record.amountRefundedPence)} refunded`:''} · {record.mode==='test'?'Test mode':'Live payment'}</span>{record.needsReview&&<p className="admin-warning">Payment status needs review. This car stays protected until the provider status is known.</p>}<div className="flex flex-wrap gap-2"><HistoryLinks vehicleId={record.vehicleId} recordType="reservation" recordId={record.id} />{access.data?.permissions.includes('sales.manage')&&record.paymentStatus==='confirmed'&&<Button asChild size="sm"><Link href={`/portal?section=sales&${record.saleId?`saleId=${record.saleId}`:`reservationId=${record.id}`}`}>Open sale</Link></Button>}{access.data?.permissions.includes('sales.manage')&&<Button size="sm" variant="outline" disabled={!!busy} onClick={()=>void resend(record.id)}>{busy===record.id?'Preparing…':'Email reservation details'}</Button>}</div></li>)}</ul>}</div></section>;
}
