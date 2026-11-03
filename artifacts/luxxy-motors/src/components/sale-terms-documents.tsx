import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import type { FullSalesTermsSettings, SalesTermsSnapshot } from '@workspace/vehicle-meta';
import { Button } from './ui/button';
import { Printer } from './icons';
import './full-sales-terms.css';
type TermsDocument = { id: string; snapshot: SalesTermsSnapshot; created_at: string };
export function SaleTermsDocuments({ saleId, saleRevision, canIssue = true, onIssued }: { saleId: string; saleRevision: number; canIssue?: boolean; onIssued?: (saleId: string) => void }) {
  const [documents, setDocuments] = useState<TermsDocument[]>([]), [settings, setSettings] = useState<FullSalesTermsSettings | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), issueGeneration = useRef(0), issueRequest = useRef<{ key: string; id: string } | null>(null);
  async function load() {
    const current = ++generation.current; setError('');
    try { const [result, terms] = await Promise.all([customFetch<{ documents: TermsDocument[] }>(`/api/sales-terms/sales/${saleId}`), customFetch<FullSalesTermsSettings>('/api/sales-terms')]); if (!result || !Array.isArray(result.documents) || !terms || typeof terms!=='object') throw new Error('Invalid terms response'); if (current === generation.current) { setDocuments(result.documents); setSettings(terms); } }
    catch { if (current === generation.current) setError('The terms documents could not be loaded. Try again.'); }
  }
  useEffect(() => { issueGeneration.current++; setDocuments([]); setSettings(null); setBusy(false); void load(); return () => { generation.current++; issueGeneration.current++; }; }, [saleId]);
  async function issue() {
    if (!settings?.published || busy) return; setBusy(true); setError('');
    const current = generation.current, operation = ++issueGeneration.current;
    const key = `${saleId}:${saleRevision}:${settings.published.id}`;
    if (issueRequest.current?.key !== key) issueRequest.current = { key, id: crypto.randomUUID() };
    try { await customFetch(`/api/sales-terms/sales/${saleId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: issueRequest.current.id, expectedSaleRevision: saleRevision, termsVersionId: settings.published.id }) }); if (current !== generation.current) return; onIssued?.(saleId); await load(); }
    catch { if (current !== generation.current) return; setError('The terms could not be issued. Reload the sale to check its current details and terms version.'); } finally { if (operation === issueGeneration.current) setBusy(false); }
  }
  async function print(documentId: string, copies: 'dealer' | 'both') {
    const tab = window.open('', '_blank'); if (tab) tab.opener = null;
    setBusy(true); setError('');
    try {
      const blob = await customFetch<Blob>(`/api/sales-terms/sales/${saleId}/${documentId}/pdf?copies=${copies}`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else { const link = document.createElement('a'); link.href = url; link.download = `sale-terms-${copies}.pdf`; link.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 300000);
    } catch { tab?.close(); setError('The print copy could not be loaded. Your issued terms are unchanged. Try again.'); }
    finally { setBusy(false); }
  }
  return <section className="sale-terms-documents sale-desk-sheet" aria-label="Sale terms documents"><div><h3>Terms and conditions</h3><p>{settings?.published ? `New documents use version ${settings.published.version}.` : 'Add the dealership’s full terms in Settings before issuing a customer copy.'}</p></div>
    {error && <p role="alert">{error} <Button variant="outline" onClick={() => void load()}>Try again</Button></p>}
    {settings?.published && canIssue && <Button variant="outline" disabled={busy || documents.some(d => d.snapshot.saleRevision === saleRevision && d.snapshot.termsVersionId === settings.published?.id)} onClick={() => void issue()}>{busy ? 'Preparing terms…' : 'Issue terms for this sale'}</Button>}
    {documents.map(document => <article className="sale-terms-document" key={document.id}><div><strong>{document.snapshot.title}</strong><small>Version {document.snapshot.termsVersion} · {new Date(document.created_at).toLocaleDateString('en-GB')} · {document.snapshot.registration}</small></div><div className="sale-terms-document-actions"><Button variant="outline" disabled={busy} onClick={() => void print(document.id, 'dealer')}><Printer size={16} /> Dealer copy</Button><Button variant="outline" disabled={busy} onClick={() => void print(document.id, 'both')}><Printer size={16} /> Dealer and customer copies</Button></div></article>)}
  </section>;
}
