import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function RoadTaxGuide({ registration, vin, vehicle, enabled, disabled, onChange }: {
  registration: string; vin: string; vehicle: string; enabled: boolean; disabled?: boolean; onChange: (value: boolean) => void;
}) {
  // The document reference is deliberately never included in the sale draft,
  // local storage, URL, analytics or a backend request.
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const valid = /^\d{12}$/.test(reference) && Boolean(registration.trim()) && (!vin || /^[A-HJ-NPR-Z0-9]{17}$/.test(vin));
  async function download() {
    if (!valid || busy) return;
    setBusy(true); setMessage('');
    try {
      const { roadTaxGuidePdfBytes } = await import('@workspace/vehicle-meta/sale-document-pdf');
      const bytes = roadTaxGuidePdfBytes({ registration, vin, vehicle, reference });
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
      const link = document.createElement('a'); link.href = url; link.download = 'road-tax-guide.pdf'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setReference(''); setMessage('Guide downloaded. Keep it private: it contains the green slip reference.');
    } catch { setMessage('The guide could not be created. Please try again.'); }
    finally { setBusy(false); }
  }
  return <section className="invoice-tax-guide" aria-label="Road Tax guide">
    <label>Generate a Road Tax guide?
      <select value={enabled ? 'yes' : 'no'} disabled={disabled || busy} onChange={event => {
        setReference(''); setMessage(''); onChange(event.target.value === 'yes');
      }}><option value="no">No</option><option value="yes">Yes</option></select>
    </label>
    {enabled && <>
      <label>Green slip document number (V5C/2)
        <Input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={reference}
          disabled={busy} onChange={event => { setReference(event.target.value.replace(/\s/g, '')); setMessage(''); }}
          aria-describedby="tax-guide-help" />
      </label>
      <p id="tax-guide-help" className="invoice-note">Enter the 12 digits from the latest green new keeper slip. This number is used only in this download and is not saved. The guide does not tax the car.</p>
      {reference && !/^\d{12}$/.test(reference) && <p role="alert">Enter exactly 12 digits.</p>}
      {!registration.trim() && <p role="alert">Enter the number plate first.</p>}
      <Button type="button" variant="outline" disabled={!valid || busy} onClick={download}>{busy ? 'Creating guide…' : 'Download Road Tax guide'}</Button>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
