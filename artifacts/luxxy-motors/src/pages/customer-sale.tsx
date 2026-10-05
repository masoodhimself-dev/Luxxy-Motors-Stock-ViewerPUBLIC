import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import type { CustomerSaleView, SaleWorkspaceDocument } from '@workspace/vehicle-meta';
import { SalesDocument } from '@/components/sales-demo/sales-document';
import { Button } from '@/components/ui/button';
import { CarFront, WalletCards, CalendarDays, Truck, FileText, ArrowLeft, Download, LockKeyhole } from 'lucide-react';
import './customer-sale.css';

const money = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100);
const date = (value: string) => new Date(value.length === 10 ? value + 'T12:00:00Z' : value).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' });
export default function CustomerSale() {
  const { token = '' } = useParams<{ token: string }>();
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const query = useQuery({ queryKey: ['customer-sale', token], queryFn: () => customFetch<{ sale: CustomerSaleView }>(`/api/customer-sale/${encodeURIComponent(token)}`), retry: false, refetchInterval: 30000, gcTime: 0 });
  const doc = useQuery({ queryKey: ['customer-sale-document', token, documentId], queryFn: () => customFetch<{ document: SaleWorkspaceDocument }>(`/api/customer-sale/${encodeURIComponent(token)}/documents/${encodeURIComponent(documentId!)}`), enabled: Boolean(documentId), retry: false, gcTime: 0 });
  useEffect(() => {
    const robots = window.document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex, nofollow';
    const referrer = window.document.createElement('meta'); referrer.name = 'referrer'; referrer.content = 'no-referrer';
    window.document.head.append(robots, referrer); return () => { robots.remove(); referrer.remove(); };
  }, []);
  useEffect(() => { setDocumentId(null); }, [token]);
  const sale = query.data?.sale;
  if (query.isLoading) return <div className="customer-purchase"><p role="status">Opening your purchase…</p></div>;
  if (!sale || query.isError) return <div className="customer-purchase"><div className="customer-purchase-card"><LockKeyhole size={28} /><h1>This customer link is unavailable</h1><p>It may have expired or been replaced. Contact the showroom for a new link.</p><Link href="/contact">Contact the showroom</Link></div></div>;
  const download = async () => {
    if (!documentId) return;
    try { setDownloadError(''); const file = await customFetch<Blob>(`/api/customer-sale/${token}/documents/${documentId}/pdf`, { responseType: 'blob' }); const url = URL.createObjectURL(file); const a = window.document.createElement('a'); a.href = url; a.download = (doc.data?.document.number ?? 'sale-document') + '.pdf'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
    catch { setDownloadError('The saved PDF could not be downloaded. Please try again.'); }
  };
  if (documentId) return <div className="customer-purchase customer-purchase-document"><div className="customer-document-toolbar"><Button variant="outline" onClick={() => setDocumentId(null)}><ArrowLeft size={16} />Your purchase</Button><Button onClick={() => void download()} disabled={!doc.data}><Download size={16} />Download PDF</Button></div>{downloadError && <p role="alert">{downloadError}</p>}{doc.isLoading ? <p role="status">Opening saved document…</p> : doc.data ? <SalesDocument issuedDocument={doc.data.document} /> : <p role="alert">This document is unavailable. Please contact the showroom.</p>}</div>;
  return <div className="customer-purchase">
    <header className="customer-purchase-heading"><span><LockKeyhole size={16} />Private customer page</span><p>{sale.dealer.identity.name}</p><h1>Your purchase, {sale.customer}</h1><p>Sale {sale.reference}</p></header>
    <section className="customer-purchase-card customer-purchase-vehicle"><CarFront size={26} /><div><h2>{sale.vehicle}</h2>{sale.registration && <p className="customer-purchase-registration">{sale.registration}</p>}<p>{sale.status === 'sold' ? 'Sale completed' : sale.status === 'reserved' ? 'Reserved for you' : 'Sale in progress'}</p></div></section>
    <div className="customer-purchase-grid"><section className="customer-purchase-card"><h2><WalletCards size={20} />Your balance</h2><strong className="customer-purchase-balance">{money(Math.abs(sale.totals.balance))}</strong><p>{sale.totals.balance < 0 ? 'Customer credit — contact the showroom' : 'Outstanding balance'}</p><dl><div><dt>Total due after part exchange</dt><dd>{money(sale.totals.totalDue)}</dd></div><div><dt>Confirmed payments</dt><dd>{money(sale.totals.confirmedPaid)}</dd></div>{sale.totals.pending > 0 && <div><dt>Awaiting confirmation</dt><dd>{money(sale.totals.pending)}</dd></div>}</dl></section>
    <section className="customer-purchase-card"><h2><Truck size={20} />{sale.fulfilment?.method === 'delivery' ? 'Delivery' : 'Collection'}</h2>{sale.fulfilment?.completedAt ? <p>Completed {date(sale.fulfilment.completedAt)}{sale.fulfilment.completedRecipient ? ` · ${sale.fulfilment.completedRecipient}` : ''}</p> : sale.fulfilment?.scheduledDate ? <p>{date(sale.fulfilment.scheduledDate)}{sale.fulfilment.timeWindow ? ` · ${sale.fulfilment.timeWindow}` : ''}</p> : <p>The showroom will confirm your arrangements.</p>}{sale.fulfilment?.method === 'delivery' && sale.fulfilment.address && <p className="whitespace-pre-line">{sale.fulfilment.address}</p>}{sale.appointment && <div className="customer-purchase-appointment"><h3><CalendarDays size={18} />Viewing appointment</h3><p>{new Date(sale.appointment.at).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'long', timeStyle: 'short' })} · {sale.appointment.status}</p></div>}</section></div>
    <section className="customer-purchase-card"><h2><WalletCards size={20} />Payments & receipts</h2>{sale.payments.length ? <ul className="customer-purchase-list">{[...sale.payments].reverse().map(p => <li key={p.id}><div><strong>{p.kind.replaceAll('-', ' ')}</strong><p>{date(p.date)} · {p.method} · {p.status === 'pending' ? 'Awaiting confirmation' : 'Confirmed'}</p></div><strong>{money(p.signedAmountPence)}</strong>{p.receiptId && <Button variant="outline" onClick={() => setDocumentId(p.receiptId!)}>View receipt</Button>}</li>)}</ul> : <p>No payments have been confirmed yet.</p>}</section>
    <section className="customer-purchase-card"><h2><FileText size={20} />Your documents</h2>{sale.documents.length ? <ul className="customer-purchase-list">{[...sale.documents].reverse().map(d => <li key={d.id}><div><strong>{d.title}</strong><p>{d.number} · {date(d.issuedAt)}</p></div><Button variant="outline" onClick={() => setDocumentId(d.id)}>Open document</Button></li>)}</ul> : <p>Your issued documents will appear here.</p>}</section>
    <footer className="customer-purchase-footer"><p>Need help? <a href={`tel:${sale.dealer.contact.phone}`}>{sale.dealer.contact.phone}</a>{sale.dealer.contact.email && <> · <a href={`mailto:${sale.dealer.contact.email}`}>{sale.dealer.contact.email}</a></>}</p><p>This private link expires {date(sale.expiresAt)}.</p></footer>
  </div>;
}
