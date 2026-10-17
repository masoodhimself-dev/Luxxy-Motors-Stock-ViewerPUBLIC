import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ShieldCheck, FileCheck2, RefreshCw } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import './invoice-verification.css';

export type InvoiceProof = {
  verified: true; number: string; title: string; issuedAt: string; dealer: string; vehicle: string;
  registration: string; saleTotalPence: number; paymentsReceivedPence: number; balanceAtIssuePence: number;
  paymentCount: number; supersededBy: string | null;
};
const money = (v: number) => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(v/100);
export default function InvoiceVerification() {
  const { saleId='', documentId='', token='' } = useParams<{saleId:string;documentId:string;token:string}>();
  useEffect(() => {
    const previous=document.title; document.title='Verify invoice';
    const meta=document.createElement('meta'); meta.name='robots';meta.content='noindex, nofollow';document.head.appendChild(meta);
    const referrer=document.createElement('meta');referrer.name='referrer';referrer.content='no-referrer';document.head.appendChild(referrer);
    return()=>{ document.title=previous;meta.remove();referrer.remove(); };
  },[]);
  const query=useQuery({queryKey:['invoice-proof',saleId,documentId,token],queryFn:()=>customFetch<InvoiceProof>(`/api/invoice-verification/${encodeURIComponent(saleId)}/${encodeURIComponent(documentId)}/${encodeURIComponent(token)}`,{cache:'no-store'}),retry:false,gcTime:0,staleTime:0});
  const p=query.data;
  const status = query.error && typeof query.error === 'object' && 'status' in query.error ? Number(query.error.status) : undefined;
  const unavailable = status !== undefined && [400, 401, 403, 404, 410].includes(status);
  return <main className="invoice-proof"><article>
    <div className="invoice-proof-icon"><ShieldCheck size={28}/></div>
    {query.isLoading ? <><h1>Checking your invoice</h1><p role="status">Looking up the dealership’s saved record…</p></> : !p ? <>
      <h1>{unavailable ? 'This invoice link is unavailable' : 'We couldn’t check your invoice'}</h1>
      <p role="alert">{unavailable ? 'Scan the QR code on your original invoice, or ask the dealership for help.' : 'The verification service is temporarily unavailable. This does not mean there is a problem with your invoice. Please try again.'}</p>
      <div className="invoice-proof-actions">{!unavailable && <Button onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={16} aria-hidden="true" />{query.isFetching ? 'Checking…' : 'Try again'}</Button>}<Button asChild variant={unavailable ? 'default' : 'outline'}><Link href="/contact">Contact the dealership</Link></Button></div>
    </> : <>
      <p className="invoice-proof-eyebrow">{p.dealer}</p><h1>Invoice record found</h1>
      <p>Compare these saved details with your invoice. Amounts below are recorded at the time it was issued.</p>
      {p.supersededBy&&<p className="invoice-proof-notice">A newer invoice, {p.supersededBy}, has been issued. This is the original record.</p>}
      <dl>{[['Document',p.title],['Reference',p.number],['Issued',new Date(p.issuedAt).toLocaleDateString('en-GB',{timeZone:'Europe/London',day:'numeric',month:'long',year:'numeric'})],['Vehicle',p.vehicle],...(p.registration?[['Registration',p.registration]]:[]),['Sale total',money(p.saleTotalPence)],['Payments received',money(p.paymentsReceivedPence)],['Balance at issue',money(p.balanceAtIssuePence)],['Confirmed payments',String(p.paymentCount)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="invoice-proof-privacy"><FileCheck2 size={17}/>Customer contact details and private payment references are not shown.</p>
    </>}
  </article></main>;
}
