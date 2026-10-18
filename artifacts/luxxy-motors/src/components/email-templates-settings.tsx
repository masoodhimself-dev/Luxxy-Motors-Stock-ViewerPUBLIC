import { useEffect, useMemo, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Mail, Save, RotateCcw, Eye, Smartphone, Monitor, FileText } from '@/components/icons';
import { type EmailAppearance, type EmailTemplate } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { SettingsTabs } from '@/components/settings-tabs';
import { emailPreviewDocument } from '@/components/portal/customer-email-preview';
import './integration-settings.css';
import './email-templates-settings.css';
type TemplateResponse = { revision: number; templates: EmailTemplate[]; variables: string[]; appearance: EmailAppearance; preview?: boolean };
type Preview = { subject: string; html: string; text: string };
const categories = ['Enquiries', 'Bookings', 'Reservations', 'Sales', 'Customer access'];
const request = <T,>(path: string, method = 'GET', body?: unknown) => customFetch<T>(path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const previewKey = (id: string, subject: string, body: string, headline: string, appearance: EmailAppearance) => JSON.stringify([id,subject,body,headline,appearance]);
function messageVariables(template: EmailTemplate | undefined, available: string[]) {
  const common = ['dealer_name','dealer_phone','customer_name','reference','vehicle_title'];
  const contact = ['dealer_email','customer_email'];
  let extra: string[] = [];
  if (template?.category === 'Customer access') extra = ['portal_url','expires_at'];
  else if (template?.category === 'Sales') extra = [...contact,'vehicle_registration','document_type','document_number','amount','amount_received','balance'];
  else if (template?.category === 'Reservations') extra = [...contact,'vehicle_registration','amount','amount_received','payment_status','reservation_status','document_number','expires_at'];
  else if (template?.category === 'Bookings' || template?.id === 'appointment_details') extra = [...contact,'dealer_address','message','appointment_time','appointment_status','duration','visit_instructions','parking_instructions',...(template?.category === 'Bookings' && template.id !== 'booking_cancellation' ? ['manage_url'] : [])];
  else if (['enquiry_acknowledgement','dealer_notification','callback'].includes(template?.id ?? '')) extra = [...contact,'dealer_address','message','preferred_contact'];
  else extra = [...contact,'dealer_address','vehicle_registration','message'];
  return available.filter(variable => [...common,...extra].includes(variable));
}
export function EmailTemplatesSettings() {
  const [settingsTab, setSettingsTab] = useState('messages');
  const [data, setData] = useState<TemplateResponse>(), [selected, setSelected] = useState('enquiry_acknowledgement');
  const [headline,setHeadline] = useState(''), [subject, setSubject] = useState(''), [body, setBody] = useState(''), [preview, setPreview] = useState<Preview>();
  const [renderedKey, setRenderedKey] = useState(''), [device, setDevice] = useState<'desktop'|'phone'>('desktop'), [previewMode,setPreviewMode] = useState<'design'|'text'>('design');
  const [savedAppearance, setSavedAppearance] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  function apply(response: TemplateResponse, id = selected) {
    setData(response);
    const template = response.templates.find(item => item.id === id);
    if (template) { setSubject(template.subject); setBody(template.body); setHeadline(template.headline ?? ''); }
    setPreview(undefined); setRenderedKey('');
  }
  async function buildPreview(id: string, subject: string, body: string, headline: string, appearance: EmailAppearance) {
    const result = await request<Preview>(`/api/email-templates/${id}/preview`, 'POST', { subject, body, headline, appearance });
    setPreview(result); setRenderedKey(previewKey(id,subject,body,headline,appearance));
  }
  async function load() {
    setBusy(true); setError('');
    try {
      const result = await request<TemplateResponse>('/api/email-templates');
      apply(result); setSavedAppearance(JSON.stringify(result.appearance));
      const template = result.templates.find(item => item.id === selected);
      if (template) await buildPreview(selected,template.subject,template.body,template.headline ?? '',result.appearance);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The email templates could not be loaded.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  const active = data?.templates.find(template => template.id === selected);
  const appearanceChanged = Boolean(data && savedAppearance !== JSON.stringify(data.appearance));
  const wordingChanged = Boolean(active && (subject !== active.subject || body !== active.body || headline !== (active.headline ?? '')));
  const previewStale = Boolean(data && preview && renderedKey !== previewKey(selected,subject,body,headline,data.appearance));
  const previewDocument = useMemo(() => preview ? emailPreviewDocument(preview.html) : '', [preview?.html]);
  async function save(reset = false) {
    if (!data) return; setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<TemplateResponse>('/api/email-templates', 'PUT', { id: selected, expectedRevision: data.revision, ...(reset ? { reset: true } : { subject, body, headline }) });
      const next = { ...result, appearance: appearanceChanged ? data.appearance : result.appearance };
      apply(next);
      const template = next.templates.find(item => item.id === selected);
      setMessage(reset ? 'Default email wording restored.' : 'Email template saved. Future emails will use this wording.');
      if (template) {
        try { await buildPreview(selected,template.subject,template.body,template.headline ?? '',next.appearance); }
        catch { setError('Your template is saved, but the preview could not be refreshed. Try Update preview.'); }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The template could not be saved.'); }
    finally { setBusy(false); }
  }
  async function saveAppearance() {
    if (!data) return; setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<TemplateResponse>('/api/email-templates/appearance', 'PUT', { expectedRevision: data.revision, appearance: data.appearance });
      setData(result); setSavedAppearance(JSON.stringify(result.appearance));
      setMessage('Email branding saved for every email template.');
      try { await buildPreview(selected,subject,body,headline,result.appearance); }
      catch { setError('Your branding is saved, but the preview could not be refreshed. Try Update preview.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Email branding could not be saved.'); }
    finally { setBusy(false); }
  }
  async function showPreview() {
    if (!data) return; setBusy(true); setError('');
    try { await buildPreview(selected,subject,body,headline,data.appearance); setSettingsTab('preview'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The preview could not be created.'); }
    finally { setBusy(false); }
  }
  function appearanceField(key: keyof EmailAppearance, value: string) { setData(current => current ? { ...current, appearance: { ...current.appearance, [key]: value } } : current); }
  function insertVariable(variable: string) {
    const next = `${body}${!body || /\s$/.test(body) ? '' : ' '}{{${variable}}}`;
    if (next.length > 12000) { setError('There is not enough room for that customer detail. Shorten your message first.'); return; }
    setBody(next); setError('');
  }
  async function selectTemplate(id: string) {
    if (!data || id === selected || (wordingChanged && !window.confirm('Discard the unsaved wording for this email?'))) return;
    setSelected(id); apply(data,id); setMessage(''); setBusy(true); setError('');
    try { const template = data.templates.find(item => item.id === id); if (template) await buildPreview(id,template.subject,template.body,template.headline ?? '',data.appearance); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The preview could not be created.'); }
    finally { setBusy(false); }
  }
  return <section className="integration-settings email-design-studio" aria-label="Customise all emails" data-settings-dirty={appearanceChanged || wordingChanged}>
    <div className="integration-heading"><div><p className="integration-eyebrow">Customer communication</p><h2>Email templates</h2><p>Edit your messages and branding. Preview with sample details before saving.</p></div><Mail aria-hidden="true" /></div>
    {error && <p role="alert" className="integration-error">{error}</p>}{message && <p role="status" className="integration-notice">{message}</p>}
    {!data ? <Button type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading templates…' : 'Reload templates'}</Button> : <fieldset disabled={busy} className="email-studio-fields">
      <div className="email-settings-tabs">
        <SettingsTabs idPrefix="email-settings" label="Email settings" value={settingsTab} onValueChange={setSettingsTab} items={[{ id:'messages', label:'Messages' },{ id:'branding', label:'Branding' },{ id:'preview', label:'Preview', icon:Eye }]} />
      <div className="email-studio-grid" data-view={settingsTab}>
      <div className="email-studio-editing" hidden={settingsTab === 'preview'}>
      <div role="tabpanel" id="email-settings-panel-messages" aria-labelledby="email-settings-tab-messages" hidden={settingsTab !== 'messages'} className="email-settings-panel">
      <div className="email-studio-selector integration-field"><label htmlFor="email-template-select">Choose a message</label><NativeSelect id="email-template-select" value={selected} onChange={event => void selectTemplate(event.target.value)}>{categories.map(category => <optgroup label={category} key={category}>{data.templates.filter(template => template.category === category).map(template => <option key={template.id} value={template.id}>{template.label}</option>)}</optgroup>)}</NativeSelect><small>{data.templates.length} editable templates · saves affect future messages</small></div>
        <div className="email-studio-editor integration-card"><header><p className="email-studio-kicker">{active?.category}</p><h3>{active?.label}</h3><span>{wordingChanged ? 'Unsaved wording' : 'Saved wording'}</span></header>
          <div className="integration-field"><label htmlFor="email-subject">Subject line</label><Input id="email-subject" maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} /><small className="email-field-help"><span>Keep it clear and specific.</span><span>{subject.length.toLocaleString()} / 200</span></small></div>
          <div className="integration-field"><label htmlFor="email-title">Email title</label><Input id="email-title" maxLength={200} value={headline} onChange={event => setHeadline(event.target.value)} placeholder="Use the title for this type of message" /><small className="email-field-help"><span>Optional. Leave blank for the default title.</span><span>{headline.length.toLocaleString()} / 200</span></small></div>
          <div className="integration-field"><label htmlFor="email-body">Your message</label><Textarea id="email-body" rows={12} maxLength={12000} value={body} onChange={event => setBody(event.target.value)} /><small className="email-field-help"><span>Paragraph breaks are kept. Customer details fill in automatically; statuses and totals use the recorded facts.</span><span>{body.length.toLocaleString()} / 12,000</span></small></div>
          <details className="email-variable-help"><summary>Personalise with customer details</summary><p>Tap to add a detail supported by this message. Details not recorded for a customer may be blank.</p><div className="email-variable-list">{messageVariables(active,data.variables).map(variable => <button type="button" key={variable} onClick={() => insertVariable(variable)}>{`{{${variable}}}`}</button>)}</div></details>
          <div className="integration-actions"><Button type="button" disabled={!wordingChanged} onClick={() => void save()}><Save size={16} />Save template</Button><Button type="button" variant="outline" onClick={() => void showPreview()}><Eye size={16} />Update preview</Button></div>
          <button type="button" className="email-restore-default" onClick={() => { if (window.confirm('Replace this email’s wording with the default and save it?')) void save(true); }}><RotateCcw size={15} />Restore default wording</button>
        </div>
      </div>
      <div role="tabpanel" id="email-settings-panel-branding" aria-labelledby="email-settings-tab-branding" hidden={settingsTab !== 'branding'} className="email-settings-panel">
      <div className="integration-card email-branding-panel"><header><p className="email-studio-kicker">Shared across every message</p><h3>Email branding</h3><p>Your logo, colour and sign-off.</p><span>{appearanceChanged ? 'Unsaved branding' : 'Saved branding'}</span></header>
        <div className="integration-grid">
          <div className="integration-field"><label htmlFor="email-logo">Logo image address</label><Input id="email-logo" type="url" value={data.appearance.logoUrl} onChange={event => appearanceField('logoUrl', event.target.value)} placeholder="https://yourdomain.co.uk/logo.png" /><small>Optional HTTPS image. Your name remains visible when images are blocked.</small></div>
          <div className="integration-field"><label htmlFor="email-colour">Accent colour</label><div className="email-colour-field"><input aria-label="Choose email brand colour" type="color" value={/^#[a-f0-9]{6}$/i.test(data.appearance.brandColour) ? data.appearance.brandColour : '#172033'} onChange={event => appearanceField('brandColour', event.target.value)} /><Input id="email-colour" value={data.appearance.brandColour} onChange={event => appearanceField('brandColour', event.target.value)} maxLength={7} /></div><div className="email-colour-presets" aria-label="Email accent presets">{[['Deep blue','#24577A'],['Forest green','#286455'],['Charcoal','#253342'],['Burgundy','#763D50']].map(([name,colour]) => <button type="button" key={name} aria-label={`Use ${name} accent`} onClick={() => appearanceField('brandColour',colour)}><span style={{background:colour}} />{name}</button>)}</div><small>Buttons automatically use contrasting text. Body text stays dark and readable.</small></div>
          <div className="integration-field"><label htmlFor="email-heading">Brand heading</label><Input id="email-heading" value={data.appearance.heading} onChange={event => appearanceField('heading', event.target.value)} maxLength={200} /><small className="email-field-help"><span>Usually your dealership name.</span><span>{data.appearance.heading.length.toLocaleString()} / 200</span></small></div>
          <div className="integration-field"><label htmlFor="email-footer">Footer wording</label><Textarea id="email-footer" rows={4} value={data.appearance.footer} onChange={event => appearanceField('footer', event.target.value)} maxLength={4000} placeholder="Company information or a short sign-off" /><small className="email-field-help"><span>Contact links appear automatically. Customer variables work here too.</span><span>{data.appearance.footer.length.toLocaleString()} / 4,000</span></small></div>
        </div><div className="integration-actions"><Button type="button" disabled={!appearanceChanged} onClick={() => void saveAppearance()}>Save email branding</Button><Button type="button" variant="outline" onClick={() => void showPreview()}>Preview branding</Button></div>
      </div>
      </div>
      </div>
        <aside className="email-studio-preview" role={settingsTab === 'preview' ? 'tabpanel' : undefined} id="email-settings-panel-preview" aria-labelledby={settingsTab === 'preview' ? 'email-settings-tab-preview' : undefined} aria-label={settingsTab === 'preview' ? undefined : 'Customer email preview'}><header><div><h3>What your customer receives</h3><p>{active?.label} · sample details · no email is sent</p></div><div className="email-preview-switch" aria-label="Preview display">{([['design','Design',Eye],['text','Plain text',FileText]] as const).map(([value,label,Icon]) => <button type="button" key={value} aria-pressed={previewMode===value} onClick={() => setPreviewMode(value)}><Icon size={15}/>{label}</button>)}</div></header>
          <div className="email-preview-envelope"><span>Subject</span><strong>{preview?.subject || subject}</strong><small>To Alex Taylor · fictional customer</small></div>
          <div className="email-preview-toolbar"><div className="email-preview-switch" aria-label="Preview size"><button type="button" aria-pressed={device==='desktop'} onClick={() => setDevice('desktop')}><Monitor size={15} />Desktop</button><button type="button" aria-pressed={device==='phone'} onClick={() => setDevice('phone')}><Smartphone size={15} />Phone</button></div><span role="status">{busy ? 'Preparing…' : previewStale ? 'Preview needs updating' : preview ? 'Preview is current' : 'Preview unavailable'}</span></div>
          {preview ? previewMode==='text' ? <pre className="email-plain-preview">{preview.text}</pre> : <div className={`email-preview-canvas ${device==='phone' ? 'email-preview-phone' : ''}`}><iframe title="Email preview using sample customer information" sandbox="" referrerPolicy="no-referrer" srcDoc={previewDocument} /></div> : <div className="email-preview-empty"><Mail size={32} /><p>Preview the finished email using fictional customer details.</p><Button type="button" variant="outline" onClick={() => void showPreview()}>Build preview</Button></div>}
          {previewStale && <Button type="button" variant="outline" onClick={() => void showPreview()}>Update preview with your changes</Button>}
          <p className="integration-footnote">This is the server-generated design. Email apps may render small details differently. Saving or previewing sends no email.</p>
        </aside>
      </div>
      </div>
      <Button type="button" variant="ghost" onClick={() => { if ((!wordingChanged && !appearanceChanged) || window.confirm('Discard unsaved email wording and branding and reload?')) void load(); }}>Reload saved templates</Button>
    </fieldset>}
  </section>;
}
