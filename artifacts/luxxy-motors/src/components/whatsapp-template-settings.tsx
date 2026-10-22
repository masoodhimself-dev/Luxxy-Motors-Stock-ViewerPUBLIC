import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { renderWhatsAppTemplate, validateWhatsAppTemplate, type WhatsAppTemplate } from '@workspace/vehicle-meta';
import { MessageCircle, RotateCcw, Save } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useWhatsAppTemplates, whatsappTemplatesQueryKey } from '@/lib/whatsapp-templates';
import './whatsapp-template-settings.css';

type TemplateSettings = { revision: number; templates: Array<WhatsAppTemplate & { customised?: boolean }>; variables: readonly string[] };
const sampleDetails = {
  customer_name: 'Alex Taylor', dealer_name: 'Example Motors', vehicle_title: 'Toyota Yaris',
  vehicle_registration: 'AB21 CDE', appointment_time: 'Thursday, 29 October at 10:00',
  message: 'Here are the details we discussed. Let us know if you have any questions.',
};
const variableLabels: Record<string, string> = {
  customer_name: 'Customer name', dealer_name: 'Dealership name', vehicle_title: 'Car name',
  vehicle_registration: 'Registration', appointment_time: 'Appointment time', message: 'Staff message',
};

export function WhatsAppTemplateSettings() {
  const query = useWhatsAppTemplates();
  const cache = useQueryClient();
  // Keep the revision shown when editing began. A background refresh must not
  // silently authorise overwriting another owner's newer wording.
  const [data, setData] = useState<TemplateSettings>();
  const [selected, setSelected] = useState('enquiry');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const editor = useRef<HTMLTextAreaElement>(null);
  function apply(result: TemplateSettings, id = selected) {
    setData(result);
    setBody(result.templates.find(template => template.id === id)?.body ?? '');
  }
  useEffect(() => { if (!data && query.data) apply(query.data); }, [data, query.data]);
  const active = data?.templates.find(template => template.id === selected);
  const changed = Boolean(active && body !== active.body);
  let validation = '';
  let preview = '';
  if (active) {
    try { preview = renderWhatsAppTemplate(validateWhatsAppTemplate({ body }), sampleDetails); }
    catch (cause) { validation = cause instanceof Error ? cause.message : 'Check your message wording.'; }
  }
  async function reload() {
    if (changed && !window.confirm('Discard your unsaved WhatsApp wording and reload the saved templates?')) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const result = await query.refetch();
      if (result.error || !result.data) throw result.error ?? new Error('WhatsApp templates could not be loaded.');
      apply(result.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'WhatsApp templates could not be loaded.'); }
    finally { setBusy(false); }
  }
  async function save(reset = false) {
    if (!data || !active || busy) return;
    setError(''); setNotice('');
    if (!reset) {
      try { validateWhatsAppTemplate({ body }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Check your message wording.'); return; }
    }
    setBusy(true);
    try {
      const result = await customFetch<TemplateSettings>('/api/staff/whatsapp-templates', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: data.revision, id: selected, ...(reset ? { reset: true } : { body }) }),
      });
      cache.setQueryData(whatsappTemplatesQueryKey, result);
      apply(result);
      setNotice(reset ? 'Default WhatsApp wording restored.' : 'WhatsApp template saved. Staff can choose it when preparing a message.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Your WhatsApp template could not be saved. Your edits are still here.'); }
    finally { setBusy(false); }
  }
  function select(id: string) {
    if (!data || id === selected || (changed && !window.confirm('Discard the unsaved wording for this WhatsApp template?'))) return;
    setSelected(id); apply(data, id); setError(''); setNotice('');
  }
  function insert(variable: string) {
    const field = editor.current;
    const from = field?.selectionStart ?? body.length;
    const to = field?.selectionEnd ?? body.length;
    const token = `{{${variable}}}`;
    const next = body.slice(0, from) + token + body.slice(to);
    if (next.length > 4000) { setError('Shorten your message before adding another detail.'); return; }
    setBody(next); setError(''); setNotice('');
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(from + token.length, from + token.length); });
  }
  return <section className="whatsapp-template-settings" aria-label="WhatsApp message templates" data-settings-dirty={changed}>
    <header className="whatsapp-template-heading"><div><h3>WhatsApp message templates</h3><p>Save wording staff can choose in the WhatsApp sharing panel, then review and edit for each customer.</p></div><MessageCircle aria-hidden="true" size={22} /></header>
    {(error || (!data && query.isError)) && <div className="integration-error" role="alert"><p>{error || 'WhatsApp templates could not be loaded.'}</p><Button type="button" variant="outline" disabled={busy || query.isFetching} onClick={() => void reload()}>Reload WhatsApp templates</Button></div>}
    {notice && <p className="integration-notice" role="status">{notice}</p>}
    {!data ? query.isLoading && <p role="status">Loading WhatsApp templates…</p> : <>
      <div className="integration-field whatsapp-template-selector"><label htmlFor="whatsapp-template-select">Choose a WhatsApp message</label><NativeSelect id="whatsapp-template-select" value={selected} disabled={busy} onChange={event => select(event.target.value)}>{data.templates.map(template => <option value={template.id} key={template.id}>{template.label}</option>)}</NativeSelect></div>
      <div className="whatsapp-template-grid">
        <div className="integration-card whatsapp-template-editor">
          <div className="whatsapp-template-state"><h4>{active?.label}</h4><span>{changed ? 'Unsaved wording' : active?.customised ? 'Your saved wording' : 'Default wording'}</span></div>
          <div className="integration-field"><label htmlFor="whatsapp-template-body">WhatsApp message</label><Textarea ref={editor} id="whatsapp-template-body" rows={9} maxLength={4000} value={body} disabled={busy} aria-describedby="whatsapp-template-help whatsapp-template-validation" aria-invalid={Boolean(validation)} onChange={event => { setBody(event.target.value); setError(''); setNotice(''); }} /><small id="whatsapp-template-help" className="whatsapp-template-help"><span>Plain text and paragraph breaks. Details in double braces fill in for each customer.</span><span>{body.length.toLocaleString()} / 4,000</span></small><p id="whatsapp-template-validation" className={validation ? 'whatsapp-template-validation' : 'sr-only'} role={validation ? 'status' : undefined}>{validation || 'Message wording is valid.'}</p></div>
          <details className="whatsapp-template-variables"><summary>Insert a customer detail</summary><p>Choose a detail to insert it at the cursor. Missing details may be blank.</p><div>{data.variables.map(variable => <Button type="button" variant="outline" size="sm" key={variable} disabled={busy} onClick={() => insert(variable)} title={`{{${variable}}}`}>{variableLabels[variable] ?? variable}</Button>)}</div></details>
          <div className="integration-actions"><Button type="button" disabled={busy || !changed || Boolean(validation)} onClick={() => void save()}><Save size={16} />{busy ? 'Saving…' : 'Save WhatsApp template'}</Button><Button type="button" variant="outline" disabled={busy || !changed} onClick={() => { setBody(active?.body ?? ''); setError(''); setNotice(''); }}>Undo wording changes</Button></div>
          <button type="button" className="whatsapp-template-reset" disabled={busy} onClick={() => { if (window.confirm(`Replace the “${active?.label}” WhatsApp wording with the default and save it?`)) void save(true); }}><RotateCcw size={15} />Restore default wording</button>
        </div>
        <aside className="integration-card whatsapp-template-preview" aria-label="WhatsApp wording preview"><header><h4>Sample message</h4><p>Fictional customer and car · nothing is sent</p></header>{validation ? <p className="whatsapp-template-empty">Correct the message wording to see the sample.</p> : <div className="whatsapp-template-bubble">{preview}</div>}<p className="integration-footnote">This previews your wording. Required car, appointment and invoice details, plus selected attachment links, are added automatically when staff prepare the message.</p></aside>
      </div>
      <p className="integration-footnote">These are your dealership’s WhatsApp templates. Email wording stays separate. Staff choose a template to use it; saving here does not replace an existing prepared message.</p>
      <div><Button type="button" variant="ghost" disabled={busy || query.isFetching} onClick={() => void reload()}>Reload saved WhatsApp templates</Button></div>
    </>}
  </section>;
}
