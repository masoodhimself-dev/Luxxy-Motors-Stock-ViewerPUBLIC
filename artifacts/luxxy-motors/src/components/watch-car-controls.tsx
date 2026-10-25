import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Bell, Check } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSavedCars } from '@/lib/saved-cars-context';
import { vehicleDisplayTitle } from '@/lib/utils';
import type { Car } from '@/lib/stock-context';
import { useWatchAvailability, useWatchManagement, watchRequest } from '@/lib/vehicle-watches';
import './watch-car.css';

export function WatchCarButton({ car, className = '' }: { car: Car; className?: string }) {
  const availability = useWatchAvailability(), management = useWatchManagement();
  const { isSaved, toggleSaved } = useSavedCars();
  const savedHelpers = useRef({ isSaved, toggleSaved }); savedHelpers.current = { isSaved, toggleSaved };
  const [open, setOpen] = useState(false), [email, setEmail] = useState(''), [website, setWebsite] = useState('');
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
  const [previewLink, setPreviewLink] = useState('');
  useEffect(() => { setOpen(false); setSent(false); setEmail(''); setError(''); }, [car.id]);
  const watching = management.data?.watches.some(watch => watch.vehicleId === car.id && watch.status === 'active');
  const enabled = availability.data?.enabled && availability.data.emailReady;
  if (!watching && (!enabled || ['sold', 'hidden', 'archived'].includes(String(car.inventoryStatus ?? '')))) return null;
  async function subscribe(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await watchRequest<{ preview?: boolean; previewVerificationUrl?: string }>('', { vehicleId: car.id, email: email.trim(), website });
      if (import.meta.env.DEV && response.preview && /^\/watch#[A-Za-z0-9_-]{43}$/.test(response.previewVerificationUrl ?? '')) setPreviewLink(response.previewVerificationUrl!);
      if (!savedHelpers.current.isSaved(car.id)) savedHelpers.current.toggleSaved(car.id, car);
      setSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Updates could not be requested. Your details are kept here.'); }
    finally { setBusy(false); }
  }
  return <>
    {watching ? <Button asChild variant="ghost" className={className}><Link href="/watch"><Bell className="h-4 w-4" />Watching</Link></Button> : <Button variant="ghost" className={className} onClick={() => setOpen(true)}><Bell className="h-4 w-4" />Watch this car</Button>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="watch-car-dialog" onEscapeKeyDown={e => { if (busy) e.preventDefault(); }} onPointerDownOutside={e => { if (busy) e.preventDefault(); }}>
        <DialogHeader><DialogTitle>{sent ? 'Check your email' : 'Watch this car'}</DialogTitle><DialogDescription>{vehicleDisplayTitle(car)}</DialogDescription></DialogHeader>
        {sent ? <div className="watch-car-confirmation" role="status"><Check className="h-6 w-6" /><p>{previewLink ? 'Fictional local preview: no email was sent. Use the preview link below to test confirmation.' : <>If this address can receive updates, a confirmation link is on its way. Open it and choose <strong>Confirm updates</strong> to start watching.</>}</p>{previewLink && <Link href={previewLink} className="text-link">Open fictional confirmation</Link>}<p>The car is also saved on this browser. Nothing has been reserved.</p><Button onClick={() => setOpen(false)}>Done</Button></div> : <form onSubmit={subscribe} className="watch-car-form">
          <p>Get an email when the price drops or this car’s availability changes. No account needed.</p>
          <label htmlFor={`watch-email-${car.id}`}>Your email</label><Input id={`watch-email-${car.id}`} type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
          <div className="watch-car-honeypot" aria-hidden="true"><label>Website<Input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label></div>
          <p className="watch-car-note">Choose “Email me updates” to request updates about this car. Confirm your address first; stop at any time using the link in an email. Watching does not reserve the car.</p>
          {error && <p role="alert" className="watch-car-error">{error}</p>}
          <div className="watch-car-actions"><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Email me updates'}</Button></div>
        </form>}
      </DialogContent>
    </Dialog>
  </>;
}

export function SavedWatchSummary() {
  const management = useWatchManagement();
  const availability = useWatchAvailability();
  const active = management.data?.watches.filter(watch => watch.status === 'active') ?? [];
  const offered = availability.data?.enabled && availability.data.emailReady;
  return <aside className="saved-watch-summary" aria-label="Car updates"><Bell className="h-5 w-5" aria-hidden="true" /><div><strong>{active.length ? `Watching ${active.length} ${active.length === 1 ? 'car' : 'cars'}` : offered ? 'Want updates on a saved car?' : 'Manage your car updates'}</strong><p>{active.length ? 'Manage your email updates separately from your saved shortlist.' : offered ? 'Choose Watch this car to request price and availability updates.' : 'You can still review or stop any existing email updates.'}</p></div><Link href="/watch" className="text-link">Manage updates</Link></aside>;
}
