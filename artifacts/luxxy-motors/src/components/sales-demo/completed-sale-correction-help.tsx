import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Correction = {
  id: string;
  description: string;
  reference: string;
  recordedAt: string;
  recordedBy: string;
};

type Props = {
  corrections?: Correction[];
  instructions?: string;
  instructionsError?: boolean;
  onRetryInstructions?: () => void;
  canRecord?: boolean;
  disabled?: boolean;
  completed?: boolean;
  onRecord?: (input: { description: string; reference: string }) => Promise<void>;
};

/** Internal audit notes only: never issue documents or alter the financial ledger. */
export function CompletedSaleCorrectionHelp({ corrections = [], instructions = '', instructionsError = false, onRetryInstructions, canRecord = false, disabled = false, completed = true, onRecord }: Props) {
  const id = useId();
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!onRecord || saving || disabled || !description.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await onRecord({ description: description.trim(), reference: reference.trim() });
      setDescription(''); setReference(''); setNotice('Correction note saved to this sale.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the note. Please try again.');
    } finally { setSaving(false); }
  }
  return (
    <details className="invoice-resume-paperwork invoice-correction-notes">
      <summary>Need to correct an issued sale?</summary>
      <p>
        {completed ? 'The price and customer details of a completed sale cannot currently be changed here. ' : 'The original issued invoice is kept unchanged. '}
        Keep the original invoice and ask your manager or
        accountant how the correction should be documented, including any VAT
        treatment.
      </p>
      {instructions.trim() && <p><strong>Your dealership’s instructions:</strong> {instructions}</p>}
      {instructionsError && <p role="alert">Dealership correction instructions could not be loaded. Check with your manager. {onRetryInstructions && <Button type="button" variant="outline" onClick={onRetryInstructions}>Retry instructions</Button>}</p>}
      <p>
        Keep any correction paperwork separately with the original invoice.
        If money has actually been returned to the customer, record the refund
        separately on this sale. Recording a refund does not send money or
        correct the sale price. This guidance changes no payments or documents.
      </p>
      {corrections.length > 0 && <section aria-label="Correction notes"><h3>Correction notes</h3><ul>{corrections.map(note => <li key={note.id}><p>{note.description}</p>{note.reference && <p>Reference: {note.reference}</p>}<small>{new Date(note.recordedAt).toLocaleString('en-GB')} · {note.recordedBy}</small></li>)}</ul></section>}
      {canRecord && onRecord && <form onSubmit={submit}>
        <h3>Record a correction note</h3>
        <p>Record what happened and any accountant or paperwork reference. This note does not issue a credit note, change the price or move money.</p>
        <label htmlFor={`${id}-description`}>What happened?</label>
        <Textarea id={`${id}-description`} value={description} maxLength={2000} required disabled={saving} onChange={event => setDescription(event.target.value)} />
        <label htmlFor={`${id}-reference`}>Accountant or paperwork reference (optional)</label>
        <Input id={`${id}-reference`} value={reference} maxLength={200} disabled={saving} onChange={event => setReference(event.target.value)} />
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {disabled && !saving && <p>Save or discard other changes before recording a correction note.</p>}
        <Button type="submit" disabled={disabled || saving || !description.trim()}>{saving ? 'Saving…' : 'Save correction note'}</Button>
      </form>}
    </details>
  );
}
