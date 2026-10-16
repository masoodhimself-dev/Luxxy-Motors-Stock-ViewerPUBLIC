import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Mail, Save, RotateCcw, Eye, Smartphone, Monitor, FileText } from 'lucide-react';
import { type EmailAppearance, type EmailTemplate } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import './integration-settings.css';
import './email-templates-settings.css';
type TemplateResponse = { revision: number; templates: EmailTemplate[]; variables: string[]; appearance: EmailAppearance; preview?: boolean };
type Preview = { subject: string; html: string; text: string };
const categories = ['Enquiries', 'Bookings', 'Reservations', 'Sales', 'Customer access'];
const request = <T,>(path: string, method = 'GET', body?: unknown) => customFetch<T>(path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const previewKey = (id: string, subject: string, body: string, headline: string, appearance: EmailAppearance) => JSON.stringify([id,subject,body,headline,appearance]);
export function EmailTemplatesSettings() {
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
  async function save(reset = false) {
    if (!data) return; setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<TemplateResponse>('/api/email-templates', 'PUT', { id: selected, expectedRevision: data.revision, ...(reset ? { reset: true } : { subject, body, headline }) });
      const next = { ...result, appearance: appearanceChanged ? data.appearance : result.appearance };
      apply(next);
      const template = next.templates.find(item => item.id === selected);
      setMessage(reset ? 'Default email wording restored.' : 'Email template saved. Future emails will use this wording.');
      if (template) await buildPreview(selected,template.subject,template.body,template.headline ?? '',next.appearance);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The template could not be saved.'); }
    finally { setBusy(false); }
  }
  async function saveAppearance() {
    if (!data) return; setBusy(true); setError(''); setMessage('');
    try {
      const result = await request<TemplateResponse>('/api/email-templates/appearance', 'PUT', { expectedRevision: data.revision, appearance: data.appearance });
      setData(result); setSavedAppearance(JSON.stringify(result.appearance));
      setMessage('Email branding saved for every email template.');
      await buildPreview(selected,subject,body,headline,result.appearance);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Email branding could not be saved.'); }
    finally { setBusy(false); }
  }
  async function showPreview() {
    if (!data) return; setBusy(true); setError('');
    try { await buildPreview(selected,subject,body,headline,data.appearance); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The preview could not be created.'); }
    finally { setBusy(false); }
  }
  function appearanceField(key: keyof EmailAppearance, value: string) { setData(current => current ? { ...current, appearance: { ...current.appearance, [key]: value } } : current); }
  async function selectTemplate(id: string) {
    if (!data || id === selected || (wordingChanged && !window.confirm('Discard the unsaved wording for this email?'))) return;
    setSelected(id); apply(data,id); setMessage(''); setBusy(true); setError('');
    try { const template = data.templates.find(item => item.id === id); if (template) await buildPreview(id,template.subject,template.body,template.headline ?? '',data.appearance); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The preview could not be created.'); }
    finally { setBusy(false); }
  }
  return <section className="integration-settings email-design-studio" aria-label="Customise all emails" data-settings-dirty={appearanceChanged || wordingChanged}>
    <div className="integration-heading"><div><p className="integration-eyebrow">Customer communication</p><h2>Email templates</h2><p>Make every message feel like your dealership. Edit the words, choose your branding and see the finished email before saving.</p></div><Mail aria-hidden="true" /></div>
    {error && <p role="alert" className="integration-error">{error}</p>}{message && <p role="status" className="integration-notice">{message}</p>}
    {!data ? <Button type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading templates…' : 'Reload templates'}</Button> : <fieldset disabled={busy} className="email-studio-fields">
      <details className="integration-card email-branding-details"><summary><span>Branding for all emails<small>Your logo, accent colour, heading and footer</small></span>{appearanceChanged && <span>Unsaved changes</span>}</summary>
        <div className="integration-grid">
          <div className="integration-field"><label htmlFor="email-logo">Logo image address</label><Input id="email-logo" type="url" value={data.appearance.logoUrl} onChange={event => appearanceField('logoUrl', event.target.value)} placeholder="https://yourdomain.co.uk/logo.png" /><small>Optional HTTPS image. Your name remains visible when images are blocked.</small></div>
          <div className="integration-field"><label htmlFor="email-colour">Accent colour</label><div className="email-colour-field"><input aria-label="Choose email brand colour" type="color" value={/^#[a-f0-9]{6}$/i.test(data.appearance.brandColour) ? data.appearance.brandColour : '#172033'} onChange={event => appearanceField('brandColour', event.target.value)} /><Input id="email-colour" value={data.appearance.brandColour} onChange={event => appearanceField('brandColour', event.target.value)} maxLength={7} /></div><div className="email-colour-presets" aria-label="Email accent presets">{[['Deep blue','#24577A'],['Forest green','#286455'],['Charcoal','#253342'],['Burgundy','#763D50']].map(([name,colour]) => <button type="button" key={name} aria-label={`Use ${name} accent`} onClick={() => appearanceField('brandColour',colour)}><span style={{background:colour}} />{name}</button>)}</div><small>Buttons automatically use contrasting text. Body text stays dark and readable.</small></div>
          <div className="integration-field"><label htmlFor="email-heading">Brand heading</label><Input id="email-heading" value={data.appearance.heading} onChange={event => appearanceField('heading', event.target.value)} maxLength={200} /><small>Usually your dealership name. Each email also gets a heading suited to its purpose.</small></div>
          <div className="integration-field"><label htmlFor="email-footer">Footer wording</label><Textarea id="email-footer" rows={4} value={data.appearance.footer} onChange={event => appearanceField('footer', event.target.value)} maxLength={4000} placeholder="Company information or a short sign-off" /><small>Contact links appear automatically when supplied by the sending workflow. Variables are supported here too.</small></div>
        </div><div className="integration-actions"><Button type="button" onClick={() => void saveAppearance()}>Save email branding</Button><Button type="button" variant="outline" onClick={() => void showPreview()}>Preview branding</Button></div>
      </details>
      <div className="email-studio-selector integration-field"><label htmlFor="email-template-select">Choose a message</label><NativeSelect id="email-template-select" value={selected} onChange={event => void selectTemplate(event.target.value)}>{categories.map(category => <optgroup label={category} key={category}>{data.templates.filter(template => template.category === category).map(template => <option key={template.id} value={template.id}>{template.label}</option>)}</optgroup>)}</NativeSelect><small>{data.templates.length} editable templates · saves affect future messages</small></div>
      <div className="email-studio-grid">
        <div className="email-studio-editor integration-card"><header><p className="email-studio-kicker">{active?.category}</p><h3>{active?.label}</h3><span>{wordingChanged ? 'Unsaved wording' : 'Saved wording'}</span></header>
          <div className="integration-field"><label htmlFor="email-subject">Subject line</label><Input id="email-subject" maxLength={200} value={subject} onChange={event => setSubject(event.target.value)} /><small>Make it clear what the customer will find inside.</small></div>
          <div className="integration-field"><label htmlFor="email-title">Email title</label><Input id="email-title" maxLength={200} value={headline} onChange={event => setHeadline(event.target.value)} placeholder="Use the title for this type of message" /><small>Optional heading inside the email. Leave blank for the default; customer variables are supported.</small></div>
          <div className="integration-field"><label htmlFor="email-body">Your message</label><Textarea id="email-body" rows={12} maxLength={12000} value={body} onChange={event => setBody(event.target.value)} /><small>Write naturally. Paragraph breaks are kept, and customer details fill in the variables. Statuses, references and document totals come from the recorded facts.</small></div>
          <details className="email-variable-help"><summary>Personalise with customer details</summary><p>Tap to add a variable to the end of your message.</p><div className="email-variable-list">{data.variables.map(variable => <button type="button" key={variable} onClick={() => setBody(current => `${current}${current.endsWith(' ') || current.endsWith('\n') ? '' : ' '}{{${variable}}}`)}>{`{{${variable}}}`}</button>)}</div></details>
          <div className="integration-actions"><Button type="button" onClick={() => void save()}><Save size={16} />Save template</Button><Button type="button" variant="outline" onClick={() => void showPreview()}><Eye size={16} />Update preview</Button></div>
          <button type="button" className="email-restore-default" onClick={() => { if (window.confirm('Replace this email’s wording with the default and save it?')) void save(true); }}><RotateCcw size={15} />Restore default wording</button>
        </div>
        <aside className="email-studio-preview" aria-label="Customer email preview"><header><div><h3>What your customer receives</h3><p>Sample details · no email is sent</p></div><div className="email-preview-switch" aria-label="Preview display">{([['design','Design',Eye],['text','Plain text',FileText]] as const).map(([value,label,Icon]) => <button type="button" key={value} aria-pressed={previewMode===value} onClick={() => setPreviewMode(value)}><Icon size={15}/>{label}</button>)}</div></header>
          <div className="email-preview-envelope"><span>Subject</span><strong>{preview?.subject || subject}</strong><small>To Alex Taylor · fictional customer</small></div>
          <div className="email-preview-toolbar"><div className="email-preview-switch" aria-label="Preview size"><button type="button" aria-pressed={device==='desktop'} onClick={() => setDevice('desktop')}><Monitor size={15} />Desktop</button><button type="button" aria-pressed={device==='phone'} onClick={() => setDevice('phone')}><Smartphone size={15} />Phone</button></div><span role="status">{busy ? 'Preparing…' : previewStale ? 'Preview needs updating' : preview ? 'Preview is current' : 'Preview unavailable'}</span></div>
          {preview ? previewMode==='text' ? <pre className="email-plain-preview">{preview.text}</pre> : <div className={`email-preview-canvas ${device==='phone' ? 'email-preview-phone' : ''}`}><iframe title="Email preview using sample customer information" sandbox="" srcDoc={preview.html} /></div> : <div className="email-preview-empty"><Mail size={32} /><p>Preview the finished email using fictional customer details.</p><Button type="button" variant="outline" onClick={() => void showPreview()}>Build preview</Button></div>}
          {previewStale && <Button type="button" variant="outline" onClick={() => void showPreview()}>Update preview with your changes</Button>}
          <p className="integration-footnote">This is the server-generated design. Email apps may render small details differently. Saving or previewing sends no email.</p>
        </aside>
      </div>
      <Button type="button" variant="ghost" onClick={() => { if ((!wordingChanged && !appearanceChanged) || window.confirm('Discard unsaved email wording and branding and reload?')) void load(); }}>Reload saved templates</Button>
    </fieldset>}
  </section>;
}
