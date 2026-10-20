import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Download, Mail } from '@/components/icons';
import { saleRequestId } from './model';
type Route = 'green-slip' | 'no-logbook';
export function RoadTaxGuide({ registration, vin, vehicle, enabled, disabled, onChange, route = 'green-slip', onRouteChange, dealerName = '', customerName = '', customerEmail = '', onEmail, onBusyChange }: {
  registration: string; vin: string; vehicle: string; enabled: boolean; disabled?: boolean; onChange: (value: boolean) => void;
  route?: Route; onRouteChange?: (value: Route) => void; dealerName?: string; customerName?: string; customerEmail?: string;
  onEmail?: (reference: string, route: Route, requestId: string) => Promise<void>; onBusyChange?: (busy: boolean) => void;
}) {
  // Sensitive reference stays in component memory. It is sent transiently only
  // after staff explicitly confirm the recipient; never saved with the sale.
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState('');
  const retry = useRef<{ key: string; id: string } | null>(null);
  const emailLock = useRef(false);
  const valid = (route === 'no-logbook' || /^\d{12}$/.test(reference)) && Boolean(registration.trim()) && (!vin || /^[A-HJ-NPR-Z0-9]{17}$/.test(vin));
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customerEmail);
  function clear() { setReference(''); setConfirmed(false); setMessage(''); retry.current = null; }
  async function deliver(method: 'download' | 'email') {
    if (!valid || busy || emailLock.current || (method === 'email' && (!confirmed || !emailValid || !onEmail))) return;
    emailLock.current = true; setBusy(true); onBusyChange?.(true); setMessage('');
    try {
      if (method === 'email') {
        const key = JSON.stringify({ route, reference, customerEmail, registration, vin });
        if (retry.current?.key !== key) retry.current = { key, id: saleRequestId() };
        await onEmail!(route === 'green-slip' ? reference : '', route, retry.current.id);
        setMessage(`Guide accepted for delivery to ${customerEmail}.`);
      } else {
        const { roadTaxGuidePdfBytes } = await import('@workspace/vehicle-meta/sale-document-pdf');
        const bytes = roadTaxGuidePdfBytes({ registration, vin, vehicle, reference: route === 'green-slip' ? reference : '', route, dealerName, customerName });
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
        const link = document.createElement('a'); link.href = url; link.download = 'road-tax-guide.pdf'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setMessage(route === 'green-slip' ? 'Guide downloaded. Keep it private: it contains the green slip reference.' : 'Post Office / V62 guide downloaded.');
      }
      setReference(''); setConfirmed(false); retry.current = null;
    } catch (error) { setMessage(method === 'email' ? (error instanceof Error ? error.message : 'The email could not be sent. Try again with the same details.') : 'The guide could not be created. Please try again.'); }
    finally { emailLock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  return <section className="invoice-tax-guide" aria-label="Road Tax guide">
    <label>Generate a Road Tax guide?
      <select value={enabled ? 'yes' : 'no'} disabled={disabled || busy} onChange={event => { clear(); onChange(event.target.value === 'yes'); }}><option value="no">No</option><option value="yes">Yes</option></select>
    </label>
    {enabled && <>
      <label>Which documents are available?
        <select value={route} disabled={disabled || busy} onChange={event => { clear(); onRouteChange?.(event.target.value as Route); }}>
          <option value="green-slip">Green new keeper slip (V5C/2)</option><option value="no-logbook">No logbook or green slip — V62 guidance</option>
        </select>
      </label>
      {route === 'green-slip' ? <>
        <label>Green slip document number (V5C/2)
          <Input type="password" inputMode="numeric" autoComplete="off" maxLength={12} value={reference} disabled={busy}
            onChange={event => { setReference(event.target.value.replace(/\s/g, '')); setMessage(''); setConfirmed(false); }} aria-describedby="tax-guide-help" />
        </label>
        <p id="tax-guide-help" className="invoice-note">Enter the 12 digits from the latest green slip. It appears in the guide only and is not saved with the sale. Emailing shares it with the confirmed customer through your email provider.</p>
        {reference && !/^\d{12}$/.test(reference) && <p role="alert">Enter exactly 12 digits.</p>}
      </> : <div className="invoice-tax-route-note">
        <strong>Post Office & V62 guidance</strong>
        <p>For an existing registered keeper, a participating Post Office can handle a V62 and vehicle tax together. A new buyer without the green slip must apply for a V5C by post first, according to DVLA. Do not promise same-day tax.</p>
        <a href="https://www.gov.uk/tax-vehicle-without-v11-reminder" target="_blank" rel="noopener noreferrer">Read the current DVLA guidance</a>
      </div>}
      {!registration.trim() && <p role="alert">Enter the number plate first.</p>}
      <div className="invoice-tax-actions">
        <Button type="button" variant="outline" disabled={!valid || busy} onClick={() => deliver('download')}><Download aria-hidden="true"/> Download guide</Button>
        {onEmail && <Button type="button" disabled={!valid || busy || !confirmed || !emailValid} onClick={() => deliver('email')}><Mail aria-hidden="true"/> {busy ? 'Preparing…' : 'Email guide to customer'}</Button>}
      </div>
      {onEmail && (emailValid ? <label className="invoice-check">
        <input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)}/>
        Send this guide to {customerEmail}{route === 'green-slip' ? ', including the green slip reference.' : '.'}
      </label> : <p className="invoice-note">Add the customer’s email in step 2 to send the guide. Download is still available.</p>)}
      <p className="invoice-note">This guide does not tax the vehicle or confirm that it is taxed.</p>
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
