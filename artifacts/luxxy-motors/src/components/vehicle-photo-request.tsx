import { useId, useState } from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import './vehicle-photo-request.css';

const choices = [
  { value: 'boot', label: 'Boot', request: 'The boot' },
  { value: 'rear-seats', label: 'Rear seats', request: 'The rear seats' },
  { value: 'service-records', label: 'Service records', request: 'Any available service-book photos or service records' },
  { value: 'other', label: 'Other', request: 'Other photos described below' },
] as const;

/** Prepare a request only. The customer checks and sends the separate enquiry. */
export function VehiclePhotoRequest({ onRequest }: { onRequest: (message: string) => void }) {
  const noteId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [prepared, setPrepared] = useState(false);
  const needsDetails = selected.includes('other');
  const ready = selected.length > 0 && (!needsDetails || Boolean(note.trim()));

  return <details className="vehicle-photo-request">
    <summary>Request a photo</summary>
    <div className="vehicle-photo-request__body">
      <p>Want a closer look? Add a photo request to your enquiry, then check and send it when you’re ready.</p>
      <fieldset>
        <legend>Which photos would you like?</legend>
        <div className="vehicle-photo-request__choices">
          {choices.map(choice => <label key={choice.value}>
            <input type="checkbox" checked={selected.includes(choice.value)} onChange={event => {
              const checked = event.target.checked;
              setSelected(current => checked ? [...current, choice.value] : current.filter(value => value !== choice.value));
              setPrepared(false);
            }} />
            <span>{choice.label}</span>
          </label>)}
        </div>
      </fieldset>
      <label htmlFor={noteId}>{needsDetails ? 'Which other photo would you like?' : 'Anything specific? (optional)'}</label>
      <Textarea id={noteId} rows={2} maxLength={500} value={note} onChange={event => { setNote(event.target.value); setPrepared(false); }} placeholder="For example, the boot with the rear seats folded." />
      <Button type="button" variant="outline" className="min-h-11" disabled={!ready} onClick={() => {
        const requested = choices.filter(choice => selected.includes(choice.value)).map(choice => `• ${choice.request}`).join('\n');
        onRequest(`Could you please send photos of:\n${requested}${note.trim() ? `\n\nAdditional detail: ${note.trim()}` : ''}`);
        setPrepared(true);
      }}>Add to my enquiry</Button>
      {prepared && <p role="status">Photo request prepared. Check your enquiry before sending. Nothing has been sent.</p>}
    </div>
  </details>;
}
