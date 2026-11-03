import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { fullSalesTermsLimits, salesTermsReviewPoints, type FullSalesTermsContent, type FullSalesTermsSettings, type SalesTermsCopies, type SalesTermsSection } from '@workspace/vehicle-meta';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { FileText, Plus, Printer, Trash2 } from './icons';
import './full-sales-terms.css';
type Settings = FullSalesTermsSettings & { reviewPoints?: string[] };
const requestMessage = (error: unknown, fallback: string) => { const value = (error as { data?: { error?: unknown } })?.data?.error; return typeof value === 'string' ? value : fallback; };
export function FullSalesTermsSettings() {
  const [settings, setSettings] = useState<Settings | null>(null), [content, setContent] = useState<FullSalesTermsContent | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirm, setConfirm] = useState(false), [copies, setCopies] = useState<SalesTermsCopies>('dealer'), [category, setCategory] = useState('');
  const changed = !!settings && JSON.stringify(content) !== JSON.stringify(settings.draft);
  const reviewPoints = content ? [...new Set([...salesTermsReviewPoints(content), ...(settings?.reviewPoints?.filter(p => p.includes('settings mention')) ?? [])])] : [];
  async function load() {
    setBusy(true); setError('');
    try { const next = await customFetch<Settings>('/api/sales-terms'); setSettings(next); setContent(next.draft); }
    catch { setError('The full terms could not be loaded. Try again.'); } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!changed) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [changed]);
  function edit(next: FullSalesTermsContent) { setContent(next); setConfirm(false); setNotice(''); }
  function editSection(index: number, next: Partial<SalesTermsSection>) { if (content) edit({ ...content, sections: content.sections.map((s, i) => i === index ? { ...s, ...next } : s) }); }
  async function save() {
    if (!content || !settings) return; setBusy(true); setError(''); setNotice('');
    try { const next = await customFetch<Settings>('/api/sales-terms', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: settings.revision, content }) }); setSettings(next); setContent(next.draft); setNotice('Review draft saved. The terms used on new sales have not changed.'); }
    catch (error) { setError(`${requestMessage(error, 'Could not save.')} Your wording is kept. Reload if another member of staff changed the terms.`); } finally { setBusy(false); }
  }
  async function publish() {
    if (!settings || changed || !confirm) return; setBusy(true); setError(''); setNotice('');
    try { const next = await customFetch<Settings>('/api/sales-terms/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: settings.revision, confirm: true }) }); setSettings(next); setContent(next.draft); setConfirm(false); setNotice(`Version ${next.published?.version} will be used on new terms documents. Existing documents keep their original wording.`); }
    catch (error) { setError(requestMessage(error, 'Could not use this version. Reload the saved draft and try again.')); } finally { setBusy(false); }
  }
  async function preview() {
    if (!content) return; setBusy(true); setError('');
    // Open synchronously so the requested preview is not blocked as an unsolicited popup.
    const tab = window.open('', '_blank'); if (tab) tab.opener = null;
    try {
      const blob = await customFetch<Blob>('/api/sales-terms/preview', { method: 'POST', responseType: 'blob', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, copies, category }) });
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else { const link = document.createElement('a'); link.href = url; link.download = 'terms-review-draft.pdf'; link.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 300000);
    } catch (error) { tab?.close(); setError(requestMessage(error, 'The print preview could not be prepared. Check the wording and try again.')); } finally { setBusy(false); }
  }
  return <section className="full-sales-terms" aria-label="Full dealership terms" data-settings-dirty={changed}>
    <header className="full-terms-heading"><FileText size={24} /><div><h3>Full terms and conditions</h3><p>Your dealership’s wording, in the same A4 format as the invoice. Saved terms documents keep their original version.</p></div></header>
    {error && <p className="integration-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!settings || !content ? <Button disabled={busy} onClick={() => void load()}>{busy ? 'Loading terms…' : 'Try again'}</Button> : <>
      <div className="full-terms-status"><span>{settings.published ? `In use: version ${settings.published.version}` : 'No version in use'}</span><span>{changed ? 'Unsaved changes' : settings.revision ? 'Review draft saved' : 'Review draft'}</span></div>
      {settings.suppliedDraft && <p className="full-terms-note">Shore Drive’s supplied wording is loaded as a review draft. It has not been put into use.</p>}
      <fieldset disabled={busy} className="full-terms-editor">
        <label className="integration-field">Document title<Input value={content.title} maxLength={fullSalesTermsLimits.title} onChange={e => edit({ ...content, title: e.target.value })} /></label>
        <div className="full-terms-sections">{content.sections.map((section, index) => <details key={index} className="full-terms-section" open={content.sections.length === 1 || undefined}>
          <summary>{section.heading || `Section ${index + 1}`}<small>{section.condition === 'category-s' ? 'Category S only' : 'All vehicles'}</small></summary>
          <div className="full-terms-section-body">
            <label className="integration-field">Heading<Input maxLength={fullSalesTermsLimits.heading} value={section.heading} onChange={e => editSection(index, { heading: e.target.value })} /></label>
            <label className="integration-field">Applies to<select value={section.condition} onChange={e => editSection(index, { condition: e.target.value as SalesTermsSection['condition'] })}><option value="all">All vehicles</option><option value="category-s">Confirmed Category S vehicles only</option></select></label>
            <label className="integration-field">Wording<Textarea rows={7} value={section.paragraphs.join('\n\n')} onChange={e => editSection(index, { paragraphs: e.target.value.split(/\n\s*\n/) })} /><small>Use a blank line between paragraphs.</small></label>
            <Button type="button" variant="outline" onClick={() => edit({ ...content, sections: content.sections.filter((_, i) => i !== index) })}><Trash2 size={16} /> Remove section</Button>
          </div>
        </details>)}</div>
        <Button type="button" variant="outline" disabled={content.sections.length >= fullSalesTermsLimits.sections} onClick={() => edit({ ...content, sections: [...content.sections, { heading: '', paragraphs: [''], condition: 'all' }] })}><Plus size={16} /> Add section</Button>
      </fieldset>
      {!!reviewPoints.length && <aside className="full-terms-note" aria-label="Wording to review"><strong>Wording to review</strong><ul>{reviewPoints.map(point => <li key={point}>{point}</li>)}</ul></aside>}
      <div className="full-terms-print"><label className="integration-field">Print copies<select value={copies} onChange={e => setCopies(e.target.value as SalesTermsCopies)}><option value="dealer">Dealer copy only</option><option value="both">Dealer and customer copies</option></select></label><label className="integration-field">Preview vehicle category<select value={category} onChange={e => setCategory(e.target.value)}><option value="">Other or unconfirmed</option><option value="S">Category S</option></select></label><Button variant="outline" disabled={busy || !content.sections.length} onClick={() => void preview()}><Printer size={18} /> Print preview</Button></div>
      <div className="full-terms-actions"><Button disabled={busy || (!changed && settings.revision > 0) || !content.sections.length} onClick={() => void save()}>Save review draft</Button><div className="full-terms-publication"><label><input type="checkbox" checked={confirm} disabled={busy || changed || !settings.revision} onChange={e => setConfirm(e.target.checked)} /> Use this saved wording for new sales</label><Button variant="outline" disabled={busy || changed || !confirm || !settings.revision} onClick={() => void publish()}>Use on new sales</Button></div></div>
    </>}
  </section>;
}
