import { PlatformFeatureControls } from '@/components/platform-feature-controls';
import { DemoOnboardingAccess } from '@/components/demo-onboarding-access';
import { PlatformDemos } from '@/components/platform-demos';
import { PlatformDomainAutomation } from '@/components/platform-domain-automation';
import { PlatformCapacity } from '@/components/platform-capacity';
import { importCapacitySummary } from '../../../api-server/src/lib/platform-capacity';
import { useEffect, useState } from 'react';
import { SignInButton, useAuth } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { Building2, LayoutDashboard, Plus, Search, ArrowLeft, ArrowRight, Globe2, Radio, Users, Check, RefreshCw, Activity, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import './platform.css';
import { onboardingGroups, onboardingItems, type ChecklistEntry } from '@workspace/vehicle-meta';
type Run = { dealerId?: string; runId: string; status: string; receivedAt: string; scrapedAt: string; receivedCount: number; addedCount?: number; changedCount?: number; missingCount?: number; updatedAt?: string; expectedCount?: number; source?: string; retailerId?: string; errors?: { code?: string; message?: string }[] };
type ImportDetails = { duration_ms: number | null; change_count: number; previous_run_id: string | null; changes: { id: string; advert_id: string; title: string; added: boolean; fields: string[]; old_price: string | null; new_price: string | null }[]; newly_missing: { advert_id: string; title: string }[] | null; snapshot_details_available?: boolean };
type Domain = { hostname: string; verified: boolean; verificationToken?: string };
type Dealer = { isDemo?: boolean; demoExpiresAt?: string | null; onboardingChecklist?: Record<string, ChecklistEntry>; id: string; name: string; status: string; canonicalOrigin: string; stockPlatform: string; retailerId: string; sourceUrl: string; domains: Domain[]; activeKeyCount: number; latestImport: Run | null; lastSuccessfulImport: Run | null };
type Workspace = { dealer: Dealer; domains: Domain[]; members: { id: string; name: string | null; email: string | null; role: string; disabledAt: string | null }[]; imports: Run[]; keys: { id: string; createdAt: string; disabledAt: string | null }[] };
const call = <T,>(path: string, method = 'GET', body?: unknown) => customFetch<T>('/api/platform' + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
const date = (v?: string | null) => v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : 'Not yet';
const platform = (v: string) => v === 'cazoo' ? 'Cazoo' : 'Auto Trader';
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const steps = ['Business', 'Website', 'Owner', 'Stock source', 'Review'];
const emptyForm = { id: '', name: '', canonicalOrigin: '', platform: 'autotrader', retailerId: '', sourceUrl: '', ownerEmail: '', ownerAuthUserId: '', ownerMode: 'self' };
function Badge({ value }: { value: string }) { return <span className={`platform-badge platform-badge--${value}`}>{value}</span>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <label className="platform-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
function LaunchChecklist({ dealer, busy, save }: { dealer: Dealer; busy: boolean; save: (id: string, status: ChecklistEntry['status'], note: string) => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, { status: ChecklistEntry['status']; note: string }>>({});
  useEffect(() => setDrafts({}), [dealer.id]);
  const entries = dealer.onboardingChecklist ?? {};
  const done = onboardingItems.filter(item => entries[item.id]?.status === 'done').length;
  const skipped = onboardingItems.filter(item => entries[item.id]?.status === 'skipped').length;
  return <section className="platform-launch" aria-label="Dealer onboarding checklist">
    <div className="platform-section-heading"><div><h2>Onboarding checklist</h2><p>{done} complete · {onboardingItems.length - done - skipped} pending · {skipped} not applicable</p></div><strong>{Math.round((done + skipped) / onboardingItems.length * 100)}% resolved</strong></div>
    <progress aria-label="Onboarding progress" value={done + skipped} max={onboardingItems.length} />
    <p className="platform-help">Saved confirmations belong to this dealership. Complete means tested; not applicable requires a reason. This checklist does not activate the dealer, configure integrations or start a schedule.</p>
    {onboardingGroups.map(group => <details key={group.title} className="platform-launch-group" open><summary>{group.title}<small>{group.items.filter(i => entries[i.id] && entries[i.id].status !== 'pending').length} / {group.items.length} resolved</small></summary>{group.items.map(item => {
      const saved = entries[item.id]; const entry = drafts[item.id] ?? saved ?? { status: 'pending' as const, note: '' };
      const changed = entry.status !== (saved?.status ?? 'pending') || entry.note !== (saved?.note ?? '');
      return <div className="platform-launch-item" key={item.id}><div><strong>{item.label}</strong>{saved && <small>Saved {date(saved.updatedAt)} · {saved.updatedBy}</small>}</div><label><span className="sr-only">Status: {item.label}</span><NativeSelect disabled={busy} value={entry.status} onChange={e => setDrafts(old => ({ ...old, [item.id]: { ...entry, status: e.target.value as ChecklistEntry['status'] } }))}><option value="pending">Pending</option><option value="done">Complete</option><option value="skipped">Not applicable</option></NativeSelect></label><label className="platform-launch-note"><span className="sr-only">Notes: {item.label}</span><Input disabled={busy} maxLength={1000} value={entry.note} placeholder={entry.status === 'skipped' ? 'Reason required' : 'Evidence or next action (optional)'} onChange={e => setDrafts(old => ({ ...old, [item.id]: { ...entry, note: e.target.value } }))}/></label><Button variant="outline" disabled={busy || !changed || (entry.status === 'skipped' && !entry.note.trim())} onClick={() => void save(item.id, entry.status, entry.note)}>Save</Button></div>;
    })}</details>)}
  </section>;
}
export default function Platform() {
  const { isSignedIn } = useAuth();
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<Record<string, ImportDetails>>({});
  const [detailError, setDetailError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  async function expandRun(r: Run) {
    if (expandedRun === r.runId) { setExpandedRun(null); return; }
    setExpandedRun(r.runId); setDetailError('');
    if (runDetails[r.runId] || !r.dealerId) return;
    setDetailLoading(true);
    try { const details = await call<ImportDetails>(`/dealers/${encodeURIComponent(r.dealerId)}/imports/${encodeURIComponent(r.runId)}`); setRunDetails(old => ({ ...old, [r.runId]: details })); }
    catch { setDetailError('Could not load import details. Close and reopen to retry.'); }
    finally { setDetailLoading(false); }
  }
  const [view, setView] = useState<'overview' | 'dealers' | 'new' | 'activity' | 'workspace' | 'demos' | 'features'>('overview');
  const [data, setData] = useState<{ dealers: Dealer[]; activity: Run[] }>({ dealers: [], activity: [] });
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tab, setTab] = useState('Setup');
  const [issuedKey, setIssuedKey] = useState<{ secret: string; endpointPath: string } | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [allowed, setAllowed] = useState(false);
  const [search, setSearch] = useState(''), [status, setStatus] = useState('all');
  const [dealerKind, setDealerKind] = useState<'all' | 'live' | 'demos' | 'expired'>('all');
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const [step, setStep] = useState(0), [form, setForm] = useState(emptyForm), [alias, setAlias] = useState('');
  async function load() {
    setLoading(true); setNow(Date.now());
    try { setData(await call('/overview')); setAllowed(true); setError(''); }
    catch { setAllowed(false); setError('Platform administrator access is required on the approved administration domain. Refresh to try again.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (isSignedIn) void load(); else { setAllowed(false); setExpandedRun(null); setRunDetails({}); setData({ dealers: [], activity: [] }); setWorkspace(null); setIssuedKey(null); } }, [isSignedIn]);
  useEffect(() => { const old = document.title; document.title = 'Dealer Platform · Administration'; return () => { document.title = old; }; }, []);
  function navigate(next: typeof view) { setIssuedKey(null); setView(next); setError(''); setNotice(''); }
  async function openDealer(id: string) {
    setIssuedKey(null);
    setBusy(true); setError(''); setNotice('');
    try { const result = await call<Workspace>(`/dealers/${encodeURIComponent(id)}/workspace`); setWorkspace(result); setTab('Setup'); setAlias(''); setView('workspace'); }
    catch { setError('Could not load this dealership. Please try again.'); }
    finally { setBusy(false); }
  }
  async function refreshDealerWorkspace() {
    if (!workspace) return;
    try { setWorkspace(await call<Workspace>(`/dealers/${encodeURIComponent(workspace.dealer.id)}/workspace`)); }
    catch { setError('Domain connection completed. Refresh the dealership to see its updated domains.'); }
  }
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true); setError(''); setNotice('');
    try {
      await call(path, method, body);
      if (workspace) setWorkspace(await call(`/dealers/${encodeURIComponent(workspace.dealer.id)}/workspace`));
      await load(); setNotice('Changes saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save changes.'); }
    finally { setBusy(false); }
  }
  async function createImportKey() {
    if (!workspace || busy) return;
    if (!window.confirm(`Create a dedicated import credential for ${workspace.dealer.name}? Save the secret in Grok’s secure card before leaving this page.`)) return;
    setBusy(true); setError(''); setIssuedKey(null);
    try {
      const result = await call<{ secret: string; endpointPath: string }>(`/dealers/${encodeURIComponent(workspace.dealer.id)}/import-key`, 'POST');
      setIssuedKey(result);
      setWorkspace(await call(`/dealers/${encodeURIComponent(workspace.dealer.id)}/workspace`));
    } catch { setError('Could not complete credential creation. Refresh the credential count before trying again; a timed-out request may have created a key.'); }
    finally { setBusy(false); }
  }
  function nextStep() {
    let message = '';
    if (step === 0 && (!form.name.trim() || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(form.id))) message = 'Enter a dealership name and a unique ID using lowercase letters, numbers and hyphens.';
    if (step === 1) { try { const u = new URL(form.canonicalOrigin); if (u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || u.search || u.hash || (u.port && u.port !== '443')) throw new Error(); } catch { message = 'Enter an HTTPS website origin, without a page path. Use a domain you control.'; } }
    if (step === 2 && form.ownerMode === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.ownerEmail)) message = 'Enter the email address of an existing account.';
    if (step === 2 && form.ownerMode === 'id' && !/^user_[A-Za-z0-9]+$/.test(form.ownerAuthUserId)) message = 'Enter a Clerk user ID beginning with user_.';
    if (step === 3) { try { const u = new URL(form.sourceUrl); const hosts = form.platform === 'cazoo' ? ['cazoo.co.uk','www.cazoo.co.uk'] : ['autotrader.co.uk','www.autotrader.co.uk']; if (!form.retailerId.trim() || u.protocol !== 'https:' || !hosts.includes(u.hostname) || u.username || u.password || (u.port && u.port !== '443')) throw new Error(); } catch { message = 'Enter the exact retailer reference and an HTTPS stock URL from the selected marketplace.'; } }
    setError(message); if (!message) setStep(Math.min(step + 1, 4));
  }
  async function create() {
    setBusy(true); setError('');
    const body = { id: form.id, name: form.name, canonicalOrigin: form.canonicalOrigin, platform: form.platform, retailerId: form.retailerId, sourceUrl: form.sourceUrl, ...(form.ownerMode === 'self' ? { useMyAccount: true } : form.ownerMode === 'email' ? { ownerEmail: form.ownerEmail } : { ownerAuthUserId: form.ownerAuthUserId }) };
    try { const result = await call<{ dealerId: string }>('/dealers','POST',body); await load(); await openDealer(result.dealerId); setNotice('Draft dealership created. Complete the website and stock checks before activation.'); setForm(emptyForm); setStep(0); }
    catch(cause) { setError(cause instanceof Error ? cause.message : 'Could not create dealership.'); }
    finally { setBusy(false); }
  }
  const isExpiredDemo = (dealer: Dealer) => Boolean(dealer.isDemo && dealer.demoExpiresAt && Date.parse(dealer.demoExpiresAt) <= now);
  const liveDealers = data.dealers.filter(dealer => !dealer.isDemo);
  const liveWebsites = liveDealers.filter(dealer => dealer.status === 'active');
  const liveSetup = liveDealers.filter(dealer => dealer.status === 'draft');
  const demos = data.dealers.filter(dealer => dealer.isDemo && !isExpiredDemo(dealer));
  const activeDemos = demos.filter(dealer => dealer.status === 'active' && dealer.demoExpiresAt && Date.parse(dealer.demoExpiresAt) > now);
  const expiredDemos = data.dealers.filter(isExpiredDemo);
  const liveHealth = importCapacitySummary(liveWebsites.map(dealer => ({
    id: dealer.id, name: dealer.name, active_key_count: dealer.activeKeyCount,
    last_success_received_at: dealer.lastSuccessfulImport?.receivedAt ?? null,
    last_success_scraped_at: dealer.lastSuccessfulImport?.scrapedAt ?? null,
    last_attempt_at: dealer.latestImport?.receivedAt ?? null,
    last_attempt_status: dealer.latestImport?.status ?? null,
  })), now);
  const healthById = new Map(liveHealth.dealers.map(dealer => [dealer.dealerId, dealer]));
  const liveAttention = liveWebsites.filter(dealer => healthById.get(dealer.id)?.needsAttention);
  const setupAttention = liveDealers.filter(dealer => dealer.status === 'draft' || dealer.status === 'suspended');
  function attentionReason(dealer: Dealer) {
    if (dealer.isDemo) return '';
    if (dealer.status === 'draft') return 'Setup in progress · awaiting activation';
    if (dealer.status === 'suspended') return 'Suspended · review before reactivating';
    const health = healthById.get(dealer.id);
    if (!health?.needsAttention) return '';
    return [
      !health.connectionConfigured && 'Import credential missing',
      health.freshness === 'missing' && 'No successful stock collection',
      health.freshness === 'warning' && 'Stock update due soon · 13+ hours',
      health.freshness === 'critical' && 'Stock update overdue · 14+ hours',
      ['failed', 'quarantined'].includes(health.lastAttemptStatus ?? '') && `Latest import ${health.lastAttemptStatus}`,
    ].filter(Boolean).join(' · ');
  }
  const filtered = data.dealers.filter(dealer =>
    (dealerKind === 'all' || (dealerKind === 'live' && !dealer.isDemo) || (dealerKind === 'demos' && dealer.isDemo && !isExpiredDemo(dealer)) || (dealerKind === 'expired' && isExpiredDemo(dealer))) &&
    (status === 'all' || dealer.status === status) &&
    `${dealer.name} ${dealer.id} ${dealer.canonicalOrigin} ${dealer.retailerId}`.toLowerCase().includes(search.trim().toLowerCase()));
  function runs(items: Run[]) {
    const money = (v: string | null) => v != null && v !== 'null' && Number.isFinite(Number(v)) ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(v)) : 'Not supplied';
    return items.length ? <div className="platform-runs">{items.map(r => {
      const details = runDetails[r.runId], open = expandedRun === r.runId;
      const duration = r.status === 'completed' && r.updatedAt ? Math.max(0, new Date(r.updatedAt).getTime() - new Date(r.receivedAt).getTime()) : null;
      return <article className="platform-import-card" key={r.runId}><div className="platform-import-heading"><div><strong>{r.dealerId ? data.dealers.find(d => d.id === r.dealerId)?.name ?? workspace?.dealer.name ?? r.dealerId : 'Stock snapshot'}</strong><small>{date(r.receivedAt)} · {r.receivedCount}{r.expectedCount != null ? ` / ${r.expectedCount}` : ''} vehicles · {r.source ? platform(r.source) : 'Stock feed'}</small><code>{r.runId}</code></div><Badge value={r.status} /></div>
        <div className="platform-import-counts"><span><b>{r.addedCount ?? 0}</b> added</span><span><b>{r.changedCount ?? 0}</b> changed</span><span><b>{r.status === 'completed' ? Math.max(0, r.receivedCount - (r.addedCount ?? 0) - (r.changedCount ?? 0)) : '—'}</b> unchanged</span><span><b>{r.missingCount ?? 0}</b> absent from source</span><span>Backend processing: <b>{duration == null ? 'Not available' : `${(duration / 1000).toFixed(2)} s`}</b></span></div>
        {!!r.errors?.length && <div role="alert">{r.errors.map((e, i) => <p key={i}>{e.code ? `${e.code}: ` : ''}{e.message ?? 'Import needs attention'}</p>)}</div>}
        {r.dealerId && <Button variant="outline" aria-expanded={open} onClick={() => void expandRun(r)}>{open ? 'Hide details' : 'View vehicle changes'}</Button>}
        {open && <section className="platform-import-detail" aria-label="Import vehicle changes"><p>Collected: {date(r.scrapedAt)} · Retailer: {r.retailerId ?? 'Not recorded'}. Backend timing excludes Grok collection and network transfer. Replayed requests do not create a second import record.</p>{detailLoading && !details && <p role="status">Loading vehicle changes…</p>}{detailError && <p role="alert">{detailError}</p>}{details && <><h3>Added and changed vehicles</h3>{details.changes.length ? details.changes.map(c => <div className="platform-import-vehicle" key={c.id}><strong>{c.title || c.advert_id}</strong><small>Advert {c.advert_id}</small><span>{c.added ? 'Added to inventory' : c.old_price != null && c.new_price != null && c.old_price !== c.new_price ? `${Number(c.new_price) < Number(c.old_price) ? 'Price reduced' : 'Price changed'}: ${money(c.old_price)} → ${money(c.new_price)}` : 'Vehicle details updated'}</span>{c.fields.includes('pendingSourcePrice') && <span>Source price held for review; not automatically published.</span>}<small>{c.fields.map(f => ({ sourceImages: 'Photos', rawSourceData: 'Source details', sourcePrice: 'Price', pendingSourcePrice: 'Price held for review', priceReviewRequired: 'Price review flag', title: 'Title', description: 'Description' }[f] ?? f.replace(/([A-Z])/g, ' $1').toLowerCase())).join(' · ')}</small></div>) : <p>No recorded vehicle changes.</p>}{Number(details.change_count) > 250 && <p>Showing the first 250 of {details.change_count} changed vehicles.</p>}<h3>No longer advertised in this snapshot</h3>{details.newly_missing === null || details.snapshot_details_available === false ? <p>The original snapshot comparison is no longer retained. Import counts and recorded vehicle changes remain available.</p> : details.newly_missing.length ? details.newly_missing.map(c => <div className="platform-import-vehicle" key={c.advert_id}><strong>{c.title || c.advert_id}</strong><small>Advert {c.advert_id}</small><span>Absent from source; not marked sold.</span></div>) : <p>{details.previous_run_id ? 'No newly missing adverts.' : 'No earlier successful snapshot to compare.'}</p>}<p>Missing adverts follow the existing visibility safeguards. Dealer-controlled sold and reserved states remain protected. The absent count includes adverts already missing in earlier checks.</p></>}</section>}
      </article>;
    })}</div> : <div className="platform-empty"><Radio /><h3>No imports yet</h3><p>Successful and held stock submissions will appear here when a worker connects.</p></div>;
  }
  function dealerList(items: Dealer[], showAttention = false) {
    return items.length ? <div className="platform-dealers">{items.map(dealer => <button className="platform-dealer" key={dealer.id} disabled={busy} onClick={() => void openDealer(dealer.id)}>
      <span className="platform-dealer-avatar">{dealer.name.slice(0, 2).toUpperCase()}</span>
      <span className="platform-dealer-identity"><strong>{dealer.name}</strong><small>{new URL(dealer.canonicalOrigin).hostname}</small>
        {dealer.isDemo ? <small className="platform-demo-expiry">{dealer.demoExpiresAt ? `${isExpiredDemo(dealer) ? 'Expired' : 'Expires'} ${date(dealer.demoExpiresAt)} (UK)` : 'Demo expiry not set'}</small> : <small>Onboarding: {onboardingItems.filter(item => dealer.onboardingChecklist?.[item.id]?.status === 'done').length} / {onboardingItems.length} complete</small>}
        {showAttention && attentionReason(dealer) && <small className="platform-dealer-attention">{attentionReason(dealer)}</small>}
      </span>
      <span className="platform-dealer-source">{platform(dealer.stockPlatform)}<small>Last successful import: {date(dealer.lastSuccessfulImport?.receivedAt)}</small></span>
      <span className="platform-dealer-badges">{dealer.isDemo && <span className={`platform-badge platform-badge--${isExpiredDemo(dealer) ? 'expired' : 'demo'}`}>{isExpiredDemo(dealer) ? 'Expired demo' : 'Demo'}</span>}<Badge value={dealer.status} /></span><ArrowRight size={18} aria-hidden="true"/>
    </button>)}</div> : <div className="platform-empty"><Building2 /><h3>{data.dealers.length > 0 ? 'No dealerships match these filters' : 'Your first dealership starts here'}</h3><p>{data.dealers.length > 0 ? 'Try another search, type or status.' : 'Create a draft, connect its domain and stock source, then activate it when it is ready.'}</p>{data.dealers.length === 0 && <Button onClick={() => navigate('new')}>Add dealership</Button>}</div>;
  }
  return <div className="platform-shell">
    <aside className="platform-sidebar"><a href="/platform" className="platform-brand"><span><Building2 size={22}/></span><div>Dealer Platform<small>Management console</small></div></a><nav aria-label="Platform navigation">{([{ key:'overview', label:'Overview', icon:LayoutDashboard }, { key:'dealers', label:'Dealerships', icon:Building2 }, { key:'new', label:'Add dealership', icon:Plus }, { key:'activity', label:'Import activity', icon:Activity }, { key:'demos', label:'Demo dealerships', icon:Globe2 }, { key:'features', label:'Feature defaults', icon:ShieldCheck }] as const).map(n => <button key={n.key} className={view === n.key || (n.key === 'dealers' && view === 'workspace') ? 'is-active' : ''} disabled={!allowed || busy} onClick={() => navigate(n.key)}><n.icon size={18}/>{n.label}</button>)}</nav><div className="platform-sidebar-note"><ShieldCheck size={19}/><p>Platform administration<small>Dealer websites and staff portals stay separate.</small></p></div></aside>
    <main className="platform-main"><header className="platform-header"><div><p>Platform administration</p><h1>{view === 'workspace' ? workspace?.dealer.name : view === 'features' ? 'Feature defaults' : view === 'demos' ? 'Demo dealerships' : view === 'new' ? 'Add a dealership' : view === 'activity' ? 'Import activity' : view === 'dealers' ? 'Dealerships' : 'Your dealership network'}</h1></div>{allowed && <div className="platform-header-actions"><Button variant="outline" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16}/>Refresh</Button>{view !== 'new' && <Button disabled={busy} onClick={() => navigate('new')}><Plus size={16}/>Add dealership</Button>}</div>}</header>
      {!isSignedIn ? <section className="platform-panel platform-login"><ShieldCheck size={36}/><h2>Manage your dealerships</h2><p>Sign in with your authorised platform administrator account.</p><SignInButton mode="modal" forceRedirectUrl={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/platform`} signUpForceRedirectUrl={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/platform`}><Button>Sign in as platform administrator</Button></SignInButton></section> : <>
        {error && <p role="alert" className="platform-alert">{error}</p>}{notice && <p role="status" className="platform-notice">{notice}</p>}
        {loading && !allowed && <p role="status">Loading your dealerships…</p>}
        {allowed && view === 'overview' && <>
          <section className="platform-stats" aria-label="Dealership totals">{[
            { label: 'Live websites', count: liveWebsites.length, note: 'Active customer websites', tone: 'live' },
            { label: 'Live in setup', count: liveSetup.length, note: 'Drafts awaiting launch', tone: 'setup' },
            { label: 'Active demos', count: activeDemos.length, note: 'Active with time remaining', tone: 'demo' },
            { label: 'Expired demos', count: expiredDemos.length, note: 'Demo period has ended', tone: 'expired' },
          ].map(stat => <article key={stat.label} className={`platform-stat--${stat.tone}`} aria-label={stat.label}><span>{stat.label}</span><strong>{stat.count}</strong><small>{stat.note}</small></article>)}</section>
          <PlatformCapacity onOpenDealer={id => void openDealer(id)}/>
          <section className="platform-panel" aria-label="Dealership attention"><div className="platform-section-heading"><div><h2>Needs attention</h2><p>Live website stock health and launch tasks are tracked separately. Demos are excluded.</p></div></div>
            {data.dealers.length === 0 ? dealerList([]) : <>
              <div className="platform-attention-group"><h3>Live website health <span>{liveAttention.length}</span></h3><p>Stock collection warning after 13 hours; overdue after 14 hours. Missing credentials and failed latest imports also need attention.</p>{liveAttention.length ? dealerList(liveAttention, true) : <p className="platform-attention-clear"><Check size={17} aria-hidden="true"/>{liveWebsites.length ? 'Live stock connections are up to date.' : 'No active live websites yet.'}</p>}</div>
              <div className="platform-attention-group"><h3>Setup and suspended dealerships <span>{setupAttention.length}</span></h3>{setupAttention.length ? dealerList(setupAttention, true) : <p className="platform-attention-clear"><Check size={17} aria-hidden="true"/>No setup or suspension tasks need attention.</p>}</div>
            </>}
          </section>
          <section className="platform-panel"><div className="platform-section-heading"><h2>Recent stock activity</h2><Button variant="ghost" onClick={() => navigate('activity')}>View all <ArrowRight size={16}/></Button></div>{runs(data.activity.slice(0,5))}</section>
        </>}
        {allowed && view === 'dealers' && <section className="platform-panel">
          <div className="platform-dealer-kinds" role="group" aria-label="Dealership type">{([
            ['all', 'All', data.dealers.length], ['live', 'Live', liveDealers.length], ['demos', 'Demos', demos.length], ['expired', 'Expired', expiredDemos.length],
          ] as const).map(([kind, label, count]) => <button key={kind} type="button" aria-pressed={dealerKind === kind} onClick={() => setDealerKind(kind)}>{label}{' '}<span>{count}</span></button>)}</div>
          <div className="platform-toolbar"><Field label="Search dealerships"><div className="platform-search"><Search size={17}/><Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, domain or retailer reference" /></div></Field><Field label="Status"><NativeSelect value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="active">Active</option><option value="draft">Draft</option><option value="suspended">Suspended</option></NativeSelect></Field></div>{dealerList(filtered)}
        </section>}
        {allowed && view === 'features' && <section className="platform-panel"><PlatformFeatureControls/></section>}
        {allowed && view === 'demos' && <><section className="platform-panel"><PlatformDemos onCreated={id=>void openDealer(id).then(()=>setTab('Demo'))}/></section><DemoOnboardingAccess/></>}
        {allowed && view === 'activity' && <section className="platform-panel"><div className="platform-section-heading"><div><h2>Latest 30 submissions</h2><p>Actual import records, shown in London time. A held import is not a successful update.</p></div></div>{runs(data.activity)}</section>}
        {allowed && view === 'new' && <section className="platform-panel platform-onboarding"><ol className="platform-steps" aria-label="Onboarding progress">{steps.map((s,i) => <li key={s} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}><span>{i < step ? <Check size={15}/> : i+1}</span>{s}</li>)}</ol><div className="platform-step-body"><p className="platform-eyebrow">Step {step+1} of 5</p><h2>{['Tell us about the dealership','Choose its website address','Who will own this dealer portal?','Connect the stock source','Review your draft'][step]}</h2>
          {step === 0 && <><Field label="Dealership name"><Input value={form.name} onChange={e => setForm({...form,name:e.target.value,id:slug(e.target.value) || ''})} placeholder="e.g. Paramount Motors" /></Field><details><summary>Advanced: internal dealer ID</summary><Field label="Internal dealer ID" hint="Generated from the name. Must be unique; it cannot be changed after creation."><Input value={form.id} onChange={e => setForm({...form,id:e.target.value})}/></Field></details></>}
          {step === 1 && <><Field label="Website origin (https://…)" hint="A domain or subdomain you control. No /stock or /portal suffix."><Input value={form.canonicalOrigin} onChange={e => setForm({...form,canonicalOrigin:e.target.value})} placeholder="https://dealer.your-domain.co.uk"/></Field><p className="platform-help">After creation, we’ll show the DNS ownership record. In Domains, use automatic setup with connected Cloudflare and Render accounts, or follow the manual DNS steps. The platform admin address stays separate.</p></>}
          {step === 2 && <><Field label="Owner account"><NativeSelect value={form.ownerMode} onChange={e => setForm({...form,ownerMode:e.target.value})}><option value="self">Use my signed-in account</option><option value="email">Find an existing account by email</option><option value="id">Use a Clerk user ID (advanced)</option></NativeSelect></Field>{form.ownerMode === 'email' && <Field label="Owner email" hint="The owner must already have a Clerk account. Invitation and acceptance support is not enabled yet."><Input type="email" value={form.ownerEmail} onChange={e => setForm({...form,ownerEmail:e.target.value})}/></Field>}{form.ownerMode === 'id' && <Field label="Owner Clerk user ID"><Input value={form.ownerAuthUserId} onChange={e => setForm({...form,ownerAuthUserId:e.target.value})} placeholder="user_…"/></Field>}<p className="platform-help">This grants owner access only to this dealership. It does not grant platform administrator access.</p></>}
          {step === 3 && <><Field label="Marketplace"><NativeSelect value={form.platform} onChange={e => setForm({...form,platform:e.target.value})}><option value="autotrader">Auto Trader</option><option value="cazoo">Cazoo</option></NativeSelect></Field><Field label="Grok retailer reference" hint="Must exactly match the retailerId in this dealer’s stock snapshot."><Input value={form.retailerId} onChange={e => setForm({...form,retailerId:e.target.value})}/></Field><Field label="Authorised stock source URL"><Input type="url" value={form.sourceUrl} onChange={e => setForm({...form,sourceUrl:e.target.value})} placeholder={form.platform === 'cazoo' ? 'https://www.cazoo.co.uk/…' : 'https://www.autotrader.co.uk/…'}/></Field></>}
          {step === 4 && <><dl className="platform-facts">{[['Dealership',form.name],['Internal ID',form.id],['Website',form.canonicalOrigin],['Owner',form.ownerMode === 'self' ? 'Your signed-in account' : form.ownerMode === 'email' ? form.ownerEmail : form.ownerAuthUserId],['Marketplace',platform(form.platform)],['Retailer reference',form.retailerId],['Source',form.sourceUrl]].map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p className="platform-help">Creating this draft does not publish a website, start a Grok routine, charge a subscription or send an email.</p></>}
        </div><footer className="platform-step-footer"><Button variant="outline" disabled={busy} onClick={() => { setError(''); if (step) setStep(step-1); else navigate('dealers'); }}><ArrowLeft size={16}/>{step ? 'Back' : 'Cancel'}</Button>{step < 4 ? <Button onClick={nextStep}>Continue <ArrowRight size={16}/></Button> : <Button disabled={busy} onClick={() => void create()}>{busy ? 'Creating…' : 'Create draft dealership'}</Button>}</footer></section>}
        {allowed && view === 'workspace' && workspace && <section className="platform-panel"><div className="platform-section-heading"><Button variant="ghost" disabled={busy} onClick={() => navigate('dealers')}><ArrowLeft size={16}/>All dealerships</Button><Badge value={workspace.dealer.status}/></div><div className="platform-tabs" role="tablist" aria-label="Dealer workspace">{['Setup','Features','Domains','Stock connection','Staff','Imports','Demo'].map(t => <button role="tab" aria-selected={tab === t} key={t} onClick={() => { setIssuedKey(null); setTab(t); }}>{t}</button>)}</div><div className="platform-workspace-body">
          {tab === 'Setup' && <><LaunchChecklist dealer={workspace.dealer} busy={busy} save={(itemId, status, note) => mutate(`/dealers/${encodeURIComponent(workspace.dealer.id)}/checklist`, 'PATCH', { itemId, status, note })}/><h2>System checks</h2><ul className="platform-checklist"><li><Check/>Dealer registered as {workspace.dealer.id}</li><li>{workspace.domains.some(d => d.hostname === new URL(workspace.dealer.canonicalOrigin).hostname && d.verified) ? <Check/> : <Globe2/>}Verify website ownership in Domains</li><li><Globe2/>Connect the domain in Domains, then check HTTPS and staff sign-in before launch</li><li><Users/>{workspace.members.length} staff account{workspace.members.length !== 1 ? 's' : ''} assigned</li><li><Radio/>{workspace.keys.some(k => !k.disabledAt) ? 'Import credential exists — configure it securely in the dealer worker' : 'Stock worker credential not configured'}</li><li><Radio/>{workspace.imports.some(r => r.status === 'completed') ? 'A stock import completed — review the website before launch' : 'First stock import still pending'}</li></ul><p className="platform-help">Activation requires verified canonical DNS. A worker can only import for an active dealer. Complete domain setup first, activate for controlled testing, then verify stock and dealer settings before sharing the site.</p><div className="platform-controls"><Button disabled={busy || workspace.dealer.status === 'active' || !workspace.domains.some(d => d.verified && d.hostname === new URL(workspace.dealer.canonicalOrigin).hostname)} onClick={() => { if (window.confirm('Activate this dealer? Confirm that its Render domain and HTTPS setup are ready.')) void mutate(`/dealers/${workspace.dealer.id}/status`,'PUT',{status:'active'}); }}>Activate dealership</Button><Button variant="outline" disabled={busy || workspace.dealer.status !== 'active'} onClick={() => { if (window.confirm('Suspend this dealership? Its website and stock imports will stop being accessible.')) void mutate(`/dealers/${workspace.dealer.id}/status`,'PUT',{status:'suspended'}); }}>Suspend dealership</Button>{workspace.dealer.status === 'active' && <a href={`${workspace.dealer.canonicalOrigin}/portal`} target="_blank" rel="noreferrer" className="platform-link">Open dealer portal <ArrowRight size={15}/></a>}</div><p className="platform-help">Branding, email and payment settings are managed in the dealer portal by its authorised staff. Subscription tiers and platform billing are not configured in this dashboard yet.</p></>}
          {tab === 'Features' && <PlatformFeatureControls key={workspace.dealer.id} dealerId={workspace.dealer.id}/>}
          {tab === 'Domains' && <><PlatformDomainAutomation dealerId={workspace.dealer.id} onUpdated={() => void refreshDealerWorkspace()}/><h2>Manual domain setup</h2><p>Use this option when the dealer manages their own DNS or automatic setup is not configured.</p>{workspace.domains.map(d => <article className="platform-domain" key={d.hostname}><div className="platform-section-heading"><strong>{d.hostname}</strong><Badge value={d.verified ? 'verified' : 'pending'}/></div>{!d.verified && <><small>Add this TXT record at your DNS provider:</small><dl className="platform-facts"><div><dt>Name</dt><dd><code>_dealer-verification.{d.hostname}</code></dd></div><div><dt>Value</dt><dd><code>{d.verificationToken}</code></dd></div></dl><Button variant="outline" disabled={busy} onClick={() => void mutate(`/dealers/${workspace.dealer.id}/verify-domain`,'POST',{hostname:d.hostname})}>Check DNS ownership</Button></>}</article>)}<Field label="Add another domain" hint="Hostname only, for example www.dealer.co.uk."><Input value={alias} onChange={e => setAlias(e.target.value)}/></Field><Button variant="outline" disabled={busy || !alias.trim()} onClick={() => void mutate(`/dealers/${workspace.dealer.id}/domains`,'POST',{hostname:alias.trim()})}>Add domain</Button><p className="platform-help">In Render, add each hostname as a custom domain on the shared web service and follow its DNS instructions. Manual ownership verification does not provision certificates. The automatic setup above also checks Render’s HTTPS connection.</p></>}
          {tab === 'Stock connection' && <><h2>{platform(workspace.dealer.stockPlatform)} stock connection</h2><dl className="platform-facts"><div><dt>Retailer reference</dt><dd>{workspace.dealer.retailerId}</dd></div><div><dt>Authorised source</dt><dd>{workspace.dealer.sourceUrl}</dd></div><div><dt>Import path</dt><dd><code>/api/stock/imports/{workspace.dealer.id}/grok</code></dd></div><div><dt>Active credentials</dt><dd>{workspace.keys.filter(k => !k.disabledAt).length}</dd></div></dl><p className="platform-help">Create a dedicated credential for this dealership and enter it directly into Grok’s secure secret card. Stored secrets cannot be retrieved later.</p><Button disabled={busy || !!issuedKey} onClick={() => void createImportKey()}>Create import credential</Button>{issuedKey && <section className="platform-notice" aria-label="New import credential"><h3>Save this secret now</h3><p>Shown only during this session. Never paste it into chat or logs.</p><label className="platform-field"><span>Import secret</span><Input type="password" readOnly value={issuedKey.secret} autoComplete="off" /></label><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(issuedKey.secret).then(() => setNotice('Secret copied. Paste directly into Grok’s secure card.'), () => setError('Clipboard access failed. Select and copy the secret manually.')); }}>Copy secret</Button><Button variant="ghost" onClick={() => setIssuedKey(null)}>I have saved it — dismiss</Button></section>}<p className="platform-help">Creating a credential does not activate the dealership or start its worker. No schedule is changed here.</p></>}
          {tab === 'Staff' && <><h2>Dealer staff access</h2>{workspace.members.map(m => <article className="platform-member" key={m.id}><Users size={20}/><div><strong>{m.name || m.email || 'Registered owner account'}</strong><small>{m.email || 'Email not recorded'} · {m.role}</small></div><Badge value={m.disabledAt ? 'disabled' : 'active'}/></article>)}<p className="platform-help">Only these memberships grant access to this dealer. Team changes are available in its portal. New-user invitation emails are not enabled here yet.</p></>}
          {tab === 'Demo' && <PlatformDemos dealerId={workspace.dealer.id} onCreated={id=>void openDealer(id)}/>}
          {tab === 'Imports' && <><h2>Latest 30 stock submissions</h2>{runs(workspace.imports.map(r => ({ ...r, dealerId: workspace.dealer.id })))}</>}
        </div></section>}
      </>}
    </main>
  </div>;
}
