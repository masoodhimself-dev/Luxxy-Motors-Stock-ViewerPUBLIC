import { useEffect, useId, useRef, useState } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { WEBSITE_TEMPLATES, websiteTemplateDefinition, type WebsiteTemplateId } from '@workspace/vehicle-meta';
import { ExternalLink, Monitor, RefreshCw, Smartphone } from '@/components/icons';
import { Button } from './ui/button';
import { NativeSelect } from './ui/native-select';
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogCancel } from './ui/alert-dialog';
import { PlatformDemoLinks } from './platform-demo-links';
import './platform-website-templates.css';

type TemplateState = { dealerId: string; currentTemplate: WebsiteTemplateId; revision: number; templates: typeof WEBSITE_TEMPLATES; previewPath: string };

function TemplateDrawing({ template }: { template: string }) {
  return <div aria-hidden="true" className={`website-template-drawing website-template-drawing--${template}`}>
    <div className="website-template-drawing-nav"><i/><span/><span/><span/></div>
    <div className="website-template-drawing-content"><div className="website-template-drawing-photo"><svg viewBox="0 0 160 65" fill="none"><path d="m22 39 10-18c2-3 5-5 9-5h55c5 0 8 2 11 5l14 16 16 5v12H16V43l6-4Z" fill="currentColor" opacity=".22"/><path d="m38 23-8 15h77L95 23H38Z" fill="currentColor" opacity=".45"/><circle cx="40" cy="53" r="9" fill="currentColor"/><circle cx="114" cy="53" r="9" fill="currentColor"/></svg></div><div className="website-template-drawing-copy"><b/><span/><span/><em/></div><div className="website-template-drawing-strip"><i/><i/><i/></div></div>
  </div>;
}

export function PlatformWebsiteTemplates({ dealerId, dealerName, status, isDemo = false, refreshVersion = 0 }: {
  dealerId: string; dealerName: string; status: string; isDemo?: boolean; refreshVersion?: number;
}) {
  const id = useId();
  const [saved, setSaved] = useState<TemplateState>();
  const [selected, setSelected] = useState<WebsiteTemplateId>('showroom');
  const [previewed, setPreviewed] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const request = useRef(0);
  const endpoint = `/api/platform/dealers/${encodeURIComponent(dealerId)}/website-template`;
  async function load() {
    const version = ++request.current;
    setLoading(true); setSaving(false); setSaved(undefined); setError(''); setNotice(''); setConflict(false); setPreviewed(''); setReviewed(false); setConfirming(false);
    try {
      const result = await customFetch<TemplateState>(endpoint);
      if (version !== request.current) return;
      setSaved(result); setSelected(result.currentTemplate);
      // The preview opens in a new tab. Its return link restores the reviewed
      // candidate, but still requires the checkbox and final confirmation.
      const params = new URLSearchParams(window.location.search);
      const candidate = params.get('previewTemplate');
      if (params.get('dealer') === dealerId && params.get('previewRevision') === String(result.revision) && result.templates.some(template => template.id === candidate)) {
        setSelected(candidate as WebsiteTemplateId);
        setPreviewed(`${dealerId}/${candidate}/${result.revision}`);
      }
      if (params.get('dealer') === dealerId && (params.has('previewTemplate') || params.has('previewRevision'))) {
        const url = new URL(window.location.href);
        url.searchParams.delete('previewTemplate'); url.searchParams.delete('previewRevision');
        window.history.replaceState(null, '', url);
      }
    } catch { if (version === request.current) setError('Website designs could not be loaded. Try again.'); }
    finally { if (version === request.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [dealerId, refreshVersion]);
  const selectionKey = saved ? `${dealerId}/${selected}/${saved.revision}` : '';
  const previewPath = saved ? `${saved.previewPath}/template/${selected}/${saved.revision}` : '';
  const canApply = Boolean(saved && selected !== saved.currentTemplate && previewed === selectionKey && reviewed && !conflict && !saving);
  async function apply() {
    if (!saved || !canApply) return;
    const version = request.current;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await customFetch<Pick<TemplateState, 'dealerId' | 'currentTemplate' | 'revision'>>(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': `"${saved.revision}"` },
        body: JSON.stringify({ template: selected, reviewed: true }),
      });
      if (version !== request.current) return;
      setSaved({ ...saved, ...result }); setSelected(result.currentTemplate); setPreviewed(''); setReviewed(false); setConfirming(false);
      setNotice(`${websiteTemplateDefinition(result.currentTemplate).name} applied to ${dealerName}.`);
    } catch (cause) {
      if (version !== request.current) return;
      setConfirming(false);
      if (cause instanceof HttpApiError && cause.status === 409) {
        setConflict(true); setReviewed(false); setPreviewed('');
        setError('This dealership’s website settings changed. Reload the saved design and preview it again before applying.');
      } else {
        setConflict(true); setReviewed(false); setPreviewed('');
        setError('The design could not be confirmed. Reload the saved design before trying again.');
      }
    } finally { if (version === request.current) setSaving(false); }
  }
  return <section className="platform-website-templates" aria-labelledby={`${id}-title`} aria-busy={loading || saving}>
    <header className="platform-website-templates-heading" data-sharing={isDemo && Boolean(saved) || undefined}>
      <div><h2 id={`${id}-title`}>Website design</h2><p>Choose a design for {dealerName}, then try it with their own cars and details.</p></div>
      {isDemo && saved ? <PlatformDemoLinks key={dealerId} dealerId={dealerId} disabled={saving}
        templates={saved.templates.filter(template => !template.legacy || template.id === saved.currentTemplate)} />
        : <div className="platform-website-templates-devices" aria-label="Works on desktop and phone"><Monitor size={20}/><Smartphone size={17}/></div>}
    </header>
    {loading && <p role="status">Loading website designs…</p>}
    {error && <div className="platform-website-template-error" role="alert"><p>{error}</p><Button variant="outline" disabled={loading || saving} onClick={() => void load()}><RefreshCw size={16}/> {conflict ? 'Reload saved design' : 'Try again'}</Button></div>}
    {notice && <p className="platform-website-template-notice" role="status">{notice}</p>}
    {saved && <>
      <div className="platform-website-template-current"><span>Current design</span><strong>{websiteTemplateDefinition(saved.currentTemplate).name}</strong><span>{status === 'active' ? 'In use on this website' : 'Saved for this dealership'}</span></div>
      <fieldset disabled={saving || conflict} className="platform-website-template-options"><legend>Choose a website design</legend>
        {saved.templates.filter(template => !template.legacy).map(template => <label key={template.id} className="platform-website-template-option" data-selected={selected === template.id}>
          <input type="radio" name={`${id}-template`} value={template.id} checked={selected === template.id} onChange={() => { setSelected(template.id); setReviewed(false); setConfirming(false); setNotice(''); }}/>
          <TemplateDrawing template={template.id}/><div className="platform-website-template-option-copy"><strong>{template.name}</strong>{saved.currentTemplate === template.id && <small>Current design</small>}<p>{template.description}</p></div>
        </label>)}
      </fieldset>
      <details className="platform-website-template-previous"><summary>Original designs</summary><label><span>Use an original design</span><NativeSelect value={websiteTemplateDefinition(selected).legacy ? selected : ''} disabled={saving || conflict} onChange={event => { if (event.target.value) { setSelected(event.target.value as WebsiteTemplateId); setReviewed(false); setNotice(''); } }}><option value="" disabled>Choose a design</option>{saved.templates.filter(template => template.legacy).map(template => <option value={template.id} key={template.id}>{template.name}{template.id === saved.currentTemplate ? ' (current)' : ''}</option>)}</NativeSelect></label></details>
      <div className="platform-website-template-review"><div><h3>Preview {websiteTemplateDefinition(selected).name}</h3><p>Browse the homepage, stock and a vehicle on desktop and phone. Enquiries and payments are disabled in the private preview.</p><Button asChild variant="outline" disabled={conflict || saving}><a href={conflict || saving ? undefined : previewPath} target="_blank" rel="noopener noreferrer" aria-disabled={conflict || saving || undefined} onClick={event => { if (conflict || saving) { event.preventDefault(); return; } setPreviewed(selectionKey); setReviewed(false); }} onAuxClick={event => { if (conflict || saving) { event.preventDefault(); return; } if (event.button === 1) { setPreviewed(selectionKey); setReviewed(false); } }}>Open private preview <ExternalLink size={16}/><span className="sr-only"> in a new tab</span></a></Button></div>
        <div className="platform-website-template-apply"><label><input type="checkbox" checked={reviewed} disabled={previewed !== selectionKey || conflict || saving || selected === saved.currentTemplate} onChange={event => setReviewed(event.target.checked)}/><span>I’ve checked this preview</span></label><Button disabled={!canApply} onClick={() => setConfirming(true)}>Apply {websiteTemplateDefinition(selected).name}</Button><p>{selected === saved.currentTemplate ? 'This is the saved design.' : 'Choosing or previewing a design does not change the website.'}</p></div>
      </div>
      <AlertDialog open={confirming} onOpenChange={open => { if (!saving) setConfirming(open); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Apply {websiteTemplateDefinition(selected).name} to {dealerName}?</AlertDialogTitle><AlertDialogDescription>{status === 'active' ? 'Customers will see this design on the dealership’s website as soon as it is applied.' : 'This saves the design for this dealership. The website will stay private until it goes live.'} The cars, contact details and enabled features stay the same.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>Keep current design</AlertDialogCancel><Button disabled={!canApply} onClick={() => void apply()}>{saving ? 'Applying…' : 'Apply design'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </>}
  </section>;
}
