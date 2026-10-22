import { useEffect, useLayoutEffect, useState } from 'react';
import { renderWhatsAppTemplate, validateWhatsAppMessage, type WhatsAppTemplateId, type WhatsAppTemplateVariable } from '@workspace/vehicle-meta';
import { useWhatsAppTemplates } from '@/lib/whatsapp-templates';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

export function WhatsAppMessageEditor({ body, requiredText = '', variables, disabled, onDirtyChange, onApply }: {
  body: string; requiredText?: string; variables: Partial<Record<WhatsAppTemplateVariable, string>>;
  disabled: boolean; onDirtyChange: (dirty: boolean) => void;
  onApply: (body: string, templateId?: WhatsAppTemplateId) => Promise<void>;
}) {
  const templates = useWhatsAppTemplates();
  const [draft, setDraft] = useState(body), [selected, setSelected] = useState(''), [error, setError] = useState('');
  const dirty = draft !== body;
  useEffect(() => { setDraft(body); setError(''); }, [body]);
  useLayoutEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  let valid = true;
  try { validateWhatsAppMessage(draft); } catch { valid = false; }
  return <section className="whatsapp-message-editor" aria-label="WhatsApp message wording">
    <label>Start from a template<NativeSelect aria-label="WhatsApp message template" value={selected} disabled={disabled || templates.isFetching} onChange={event => {
      const id = event.target.value; setSelected(id); setError('');
      if (!id) { setDraft(body); return; }
      const template = templates.templates.find(item => item.id === id);
      if (template) try { setDraft(renderWhatsAppTemplate(template, variables)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'This template could not be used.'); }
    }}><option value="">Current message</option>{templates.templates.map(template => <option key={template.id} value={template.id}>{template.label}</option>)}</NativeSelect></label>
    {templates.isError && <p role="status">Saved templates could not be loaded. You can still edit this message.<Button type="button" variant="ghost" disabled={disabled || templates.isFetching} onClick={() => void templates.refetch()}>Retry templates</Button></p>}
    <label>WhatsApp message<Textarea aria-label="WhatsApp message" value={draft} maxLength={4000} rows={5} disabled={disabled} onChange={event => { setDraft(event.target.value); setError(''); }} /></label>
    <small>{draft.length.toLocaleString()} / 4,000 characters. This change is for this customer only.</small>
    {!!requiredText && <details><summary>Details included automatically</summary><pre className="phone-share-message">{requiredText}</pre><p>Car, appointment and document details are kept separate from the wording.</p></details>}
    {error && <p role="alert">{error}</p>}
    {dirty && <><p role="status">Update the QR before sending this changed message. Then scan the new QR.</p><div className="phone-share-actions"><Button type="button" disabled={disabled || !valid} onClick={() => { try { void onApply(validateWhatsAppMessage(draft), selected ? selected as WhatsAppTemplateId : undefined).catch(cause => setError(cause instanceof Error ? cause.message : 'The message could not be updated.')); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the message.'); } }}>Update QR</Button><Button type="button" variant="outline" disabled={disabled} onClick={() => { setDraft(body); setSelected(''); setError(''); }}>Undo message changes</Button></div></>}
  </section>;
}
