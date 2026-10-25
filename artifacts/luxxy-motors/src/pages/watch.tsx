import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Bell, Check } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePageMeta } from '@/hooks/use-page-meta';
import { forgetWatchAccess, rememberWatchAccess, useWatchAccess, watchRequest, type WatchManagement } from '@/lib/vehicle-watches';
import '@/components/watch-car.css';

export default function WatchPage() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1));
  const [data, setData] = useState<WatchManagement | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [email, setEmail] = useState(''), [website, setWebsite] = useState('');
  const generation = useRef(0);
  const justVerified = useRef('');
  const remembered = useWatchAccess();
  const token = hash || remembered?.token || '';
  usePageMeta({ title: 'Your car updates', description: 'Confirm or manage your private vehicle updates.', indexable: false });
  useEffect(() => { const listener = () => setHash(window.location.hash.slice(1)); window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener); }, []);
  useEffect(() => {
    const mine = ++generation.current, controller = new AbortController();
    setData(null); setError(''); if (justVerified.current !== token) setNotice(''); setLoading(true); setBusy(false);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setLoading(false); if (token) setError('This update link is incomplete. Request a fresh link below.'); return; }
    void watchRequest<WatchManagement>('/manage', undefined, token, controller.signal).then(result => {
      if (mine !== generation.current || controller.signal.aborted) return;
      setData(result); if (!result.verificationRequired && rememberWatchAccess(token, result.expiresAt)) { setHash(''); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`); }
    }).catch(cause => { if (!controller.signal.aborted && mine === generation.current) setError(cause instanceof Error ? cause.message : 'This link could not be opened.'); }).finally(() => { if (!controller.signal.aborted && mine === generation.current) setLoading(false); });
    return () => controller.abort();
  }, [token]);
  async function verify() {
    if (busy) return; const mine = generation.current; setBusy(true); setError('');
    try { const result = await watchRequest<WatchManagement>('/verify', { token }); if (mine !== generation.current) return; if (!result.token || !/^[A-Za-z0-9_-]{43}$/.test(result.token) || !Array.isArray(result.watches) || !(Date.parse(result.expiresAt) > Date.now())) throw new Error('Confirmation could not be checked. Please reopen your email link.'); justVerified.current = result.token; const stored = rememberWatchAccess(result.token, result.expiresAt); setData(result); setNotice('Updates confirmed. You are now watching this car.'); setHash(stored ? '' : result.token); window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${stored ? '' : `#${result.token}`}`); }
    catch (cause) { if (mine === generation.current) setError(cause instanceof Error ? cause.message : 'Updates could not be confirmed.'); }
    finally { if (mine === generation.current) setBusy(false); }
  }
  async function stop(id: string) {
    if (busy) return; const mine = generation.current; setBusy(true); setError('');
    try {
      await watchRequest(`/${encodeURIComponent(id)}/stop`, {}, token); if (mine !== generation.current) return;
      setData(current => current ? { ...current, watches: current.watches.map(watch => watch.id === id ? { ...watch, status: 'stopped' } : watch) } : current);
      setNotice('Updates stopped for this car. Your saved shortlist is unchanged.'); window.dispatchEvent(new Event('luxxy:vehicle-watches'));
      try { const result = await watchRequest<WatchManagement>('/manage', undefined, token); if (mine === generation.current) setData(result); }
      catch { if (mine === generation.current) setError('Updates were stopped, but the latest list could not be refreshed. Reopen your management link to check other cars.'); }
    }
    catch (cause) { if (mine === generation.current) setError(cause instanceof Error ? cause.message : 'Updates could not be stopped.'); }
    finally { if (mine === generation.current) setBusy(false); }
  }
  async function requestLink(e: FormEvent) {
    e.preventDefault(); if (busy) return; const mine = generation.current; setBusy(true); setError(''); setNotice('');
    try { await watchRequest('/manage-link', { email: email.trim(), website }); if (mine === generation.current) setNotice('If this address has car updates, a private management link is on its way. Check your email.'); }
    catch (cause) { if (mine === generation.current) setError(cause instanceof Error ? cause.message : 'The link could not be requested. Please try again.'); }
    finally { if (mine === generation.current) setBusy(false); }
  }
  return <main className="watch-page">
    <Link href="/stock" className="text-link">Back to cars</Link><h1>Your car updates</h1>
    {data?.dealerName && <p>{data.dealerName}</p>}
    <p>Price and availability updates for the cars you choose. Watching does not reserve a car.</p>
    {loading && <p className="watch-page-panel" role="status">Opening your private update link…</p>}
    {error && <p className="watch-car-error mt-5" role="alert">{error}</p>}
    {notice && <p className="watch-page-panel" role="status"><Check className="h-5 w-5" />{notice}</p>}
    {data?.verificationRequired ? <section className="watch-page-panel"><Bell className="h-6 w-6" /><h2>Confirm your updates</h2><strong>{data.vehicleTitle}</strong><p>Confirm that you want email updates when the price drops or availability changes.{data.emailHint && <> Updates will go to {data.emailHint}.</>}</p><Button onClick={() => void verify()} disabled={busy}>{busy ? 'Confirming…' : 'Confirm updates'}</Button><p className="watch-car-note">Opening this page does not start updates. If you did not request them, close the page.</p></section> : data && <>
      {data.emailHint && <p className="mt-5 text-sm">Updates for {data.emailHint}</p>}
      <ul className="watch-page-list" aria-label="Your watched cars">{data.watches.map(watch => <li key={watch.id}><div><strong>{watch.vehicleTitle}</strong><p>{watch.status === 'active' ? 'Watching · price and availability updates' : 'Updates stopped'}</p><Link href={`/vehicle/${encodeURIComponent(watch.vehicleId)}`} className="text-link">View car</Link></div>{watch.status === 'active' && <Button variant="outline" aria-label={`Stop watching ${watch.vehicleTitle}`} disabled={busy} onClick={() => void stop(watch.id)}>Stop watching</Button>}</li>)}</ul>
      {!data.watches.length && <p className="watch-page-panel">You have no cars being watched. Choose Watch this car on a vehicle page to request updates.</p>}
      <p className="watch-car-note mt-5">{remembered?.token === token ? <>Your private management access is remembered on this browser until {new Date(data.expiresAt).toLocaleDateString('en-GB')}.</> : 'This browser cannot remember your access. Keep this private link or request another management email later.'} Keep emailed management links private.</p><Button className="mt-3" variant="ghost" disabled={busy} onClick={() => { forgetWatchAccess(); setHash(''); setData(null); window.history.replaceState(null, '', window.location.pathname); }}>Forget this browser</Button>
    </>}
    {!loading && !data && <form onSubmit={requestLink} className="watch-page-panel"><h2>Manage your updates</h2><p>Enter the email you used to watch a car. We’ll send you a private link—no password needed.</p><label htmlFor="watch-manage-email">Your email</label><Input id="watch-manage-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /><div className="watch-car-honeypot" aria-hidden="true"><label>Website<Input tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} /></label></div><Button type="submit" disabled={busy}>{busy ? 'Requesting…' : 'Email my management link'}</Button></form>}
  </main>;
}
