import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import type { DemoReview } from '@workspace/vehicle-meta';
import { Camera, ExternalLink, RefreshCw, Search } from '@/components/icons';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { PublicDetailsReview, type DealerPublicDetails } from './platform-cazoo-demo';
import './platform-demo-review.css';

function groupedHours(hours: DemoReview['details']['hours']) {
  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const groups: { days: string; times: string; start: number; end: number }[] = [];
  for (const row of hours) {
    const day = weekdays.findIndex(name => name.toLowerCase() === row.days.toLowerCase());
    const previous = groups.at(-1);
    if (day >= 0 && previous && previous.start >= 0 && previous.end + 1 === day && previous.times === row.times) {
      previous.end = day;
      previous.days = `${weekdays[previous.start].slice(0, 3)}–${weekdays[day].slice(0, 3)}`;
    } else groups.push({ ...row, start: day, end: day });
  }
  return groups;
}
const count = (value: number) => value.toLocaleString('en-GB');
const money = (value: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);
const date = (value: string | null) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }) : 'Not recorded';
type Filter = 'all' | 'photos' | 'details';
function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof HttpApiError) {
    if (cause.status === 409) return 'This demo changed while you were editing. Reload the saved details, then make your changes again.';
    const message = (cause.data as { error?: unknown } | null)?.error;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}
function editableDetails(review: DemoReview): DealerPublicDetails {
  const saved = review.details.editableDetails as DealerPublicDetails | null;
  if (saved) return structuredClone(saved);
  const evidence = { sourceUrl: review.dealer.sourceUrl, checkedAt: new Date().toISOString() };
  const address = review.details.address;
  return { ...evidence, phone: review.details.phone, email: review.details.email, websiteUrl: review.details.websiteUrl,
    visitInstructions: review.details.visitInstructions,
    ...(address.street && address.city && address.postcode ? { showroomAddress: { ...address, ...evidence } } : {}),
  };
}
function SavedValue({ children }: { children?: string }) {
  return children ? <>{children}</> : <span className="platform-demo-review-missing">Not supplied</span>;
}

export function PlatformDemoReview({ dealerId, onUploadStock, onManageDemo }: {
  dealerId: string; onUploadStock: () => void; onManageDemo: () => void;
}) {
  const id = useId();
  const [review, setReview] = useState<DemoReview>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DealerPublicDetails>();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const request = useRef(0);
  const originalDraft = useRef<DealerPublicDetails | undefined>(undefined);
  const editForm = useRef<HTMLFormElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const endpoint = `/api/platform/dealers/${encodeURIComponent(dealerId)}/demo-review`;
  async function load() {
    const current = ++request.current;
    setLoading(true); setError('');
    try {
      const result = await customFetch<DemoReview>(endpoint);
      if (current !== request.current) return;
      setReview(result); setEditing(false); setSaveError('');
    } catch (cause) {
      if (current === request.current) setError(errorMessage(cause, 'The demo review could not be loaded. Try again.'));
    } finally { if (current === request.current) setLoading(false); }
  }
  useEffect(() => { void load(); return () => { request.current += 1; }; }, [dealerId]);
  useEffect(() => { if (editing) editForm.current?.querySelector<HTMLInputElement>('input')?.focus(); }, [editing]);
  useEffect(() => { if (notice && !editing && !saving) editButton.current?.focus(); }, [notice, editing, saving]);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (review?.stock.vehicles ?? []).filter(vehicle => (filter !== 'photos' || vehicle.missingPhotos)
      && (filter !== 'details' || vehicle.missingFields.length > 0)
      && (!term || `${vehicle.title} ${vehicle.registration} ${vehicle.advertId}`.toLowerCase().includes(term)))
      .sort((a, b) => Number(b.missingPhotos || b.missingFields.length > 0) - Number(a.missingPhotos || a.missingFields.length > 0));
  }, [review, filter, search]);
  const changedDetails = useMemo(() => Object.fromEntries(Object.entries(draft ?? {}).filter(([key, value]) => key !== 'sourceUrl' && key !== 'checkedAt' && value !== undefined && JSON.stringify(value) !== JSON.stringify(originalDraft.current?.[key as keyof DealerPublicDetails]))), [draft]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || !draft || saving || !Object.keys(changedDetails).length) return;
    const current = request.current;
    setSaving(true); setSaveError(''); setNotice('');
    try {
      const next = await customFetch<DemoReview>(endpoint, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: review.dealer.revision, expectedSettingsRevision: review.dealer.settingsRevision, dealershipDetails: { ...changedDetails, sourceUrl: review.dealer.sourceUrl, checkedAt: new Date().toISOString() } }) });
      if (current !== request.current) return;
      setReview(next); setEditing(false); setNotice('Dealership details saved. The private preview uses these details.');
      editButton.current?.focus();
    } catch (cause) { if (current === request.current) setSaveError(errorMessage(cause, 'The details could not be saved. Check your connection and try again.')); }
    finally { if (current === request.current) setSaving(false); }
  }

  if (!review) return <section className="platform-demo-review" aria-label="Demo review" aria-busy={loading}>
    <h2>Demo review</h2>
    {loading ? <p role="status">Loading the saved dealership and stock…</p> : <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></div>}
  </section>;

  const { dealer, details, stock, preview } = review;
  const address = [details.address.street, details.address.city, details.address.region, details.address.postcode].filter(Boolean);
  const hasIssues = stock.noPhotosCount > 0 || stock.missingInfoCount > 0 || details.missingFields.length > 0;
  return <section className="platform-demo-review" aria-labelledby={`${id}-title`} aria-busy={loading}>
    <header className="platform-demo-review-header">
      <div className="platform-demo-review-identity">
        <div className="platform-demo-review-logo">{details.hasLogo && details.logoUrl ? <img src={details.logoUrl} alt={`${dealer.name} logo`}/> : <span>Logo not supplied</span>}</div>
        <div><h2 id={`${id}-title`}>{dealer.name}</h2><p>{dealer.platform === 'cazoo' ? 'Cazoo' : 'Auto Trader'} private demo</p>
          <a href={dealer.sourceUrl} target="_blank" rel="noopener noreferrer">View dealership source <ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> in a new tab</span></a></div>
      </div>
      <div className="platform-demo-review-header-actions">
        <Button type="button" variant="outline" disabled={loading || saving} onClick={() => void load()} aria-label="Reload demo review"><RefreshCw size={16} aria-hidden="true"/>{loading ? 'Reloading…' : 'Reload'}</Button>
        {preview.allowed ? <Button asChild><a href={preview.path} target="_blank" rel="noopener noreferrer">Open private preview <ExternalLink size={16} aria-hidden="true"/><span className="sr-only"> in a new tab</span></a></Button> : <Button disabled>Open private preview</Button>}
      </div>
    </header>
    <p className="platform-demo-review-intro">Check what the dealership will see before you show the site. Changes here stay in this private demo.</p>
    {error && <p role="alert" className="platform-demo-review-warning">{error} The last loaded details are shown below.</p>}
    {notice && <p role="status" className="platform-demo-review-notice">{notice}</p>}
    {!preview.allowed && <div className="platform-demo-review-warning" role="status"><p>{preview.reason || 'The private preview is not available.'}</p><Button type="button" variant="outline" onClick={onManageDemo}>Manage demo access</Button></div>}
    <dl className="platform-demo-review-counts" aria-label="Saved stock summary">
      <div><dt>Cars imported</dt><dd>{count(stock.count)}</dd></div>
      <div className={stock.noPhotosCount ? 'has-missing' : ''}><dt>Without photos</dt><dd>{count(stock.noPhotosCount)}</dd></div>
      <div className={stock.missingInfoCount ? 'has-missing' : ''}><dt>Missing key details</dt><dd>{count(stock.missingInfoCount)}</dd></div>
    </dl>
    <div className="platform-demo-review-import-note">
      <p>Last import {date(stock.importedAt)}{stock.expectedCount !== null && <>. Export expected {count(stock.expectedCount)} cars.</>}</p>
      {stock.countMatches === false && <p className="platform-demo-review-missing">The saved car count does not match the export. Check the stock file before showing the demo.</p>}
      {hasIssues && preview.allowed && <p>You can still open the preview. Review the missing items below so you know what needs adding.</p>}
    </div>

    <section className="platform-demo-review-business" aria-labelledby={`${id}-business`}>
      <div className="platform-demo-review-section-heading"><div><h3 id={`${id}-business`}>Dealership details</h3><p>These are the saved details used on the website.</p></div>
        <Button ref={editButton} type="button" variant="outline" disabled={loading || saving} aria-expanded={editing} aria-controls={`${id}-edit`} onClick={() => {
          if (!editing) { const initial = editableDetails(review); originalDraft.current = initial; setDraft(initial); setSaveError(''); }
          setEditing(!editing);
        }}>{editing ? 'Close editor' : 'Edit details'}</Button>
      </div>
      <div className="platform-demo-review-business-grid">
        <dl className="platform-demo-review-contact"><div><dt>Phone</dt><dd><SavedValue>{details.phone}</SavedValue></dd></div>
          <div><dt>Email</dt><dd><SavedValue>{details.email}</SavedValue></dd></div>
          <div><dt>Website</dt><dd><SavedValue>{details.websiteUrl}</SavedValue></dd></div>
          <div><dt>Address</dt><dd>{address.length ? address.map((part, index) => <span key={index}>{part}</span>) : <SavedValue/>}</dd></div>
        </dl>
        <div className="platform-demo-review-hours"><h4>Opening hours</h4>
          {details.hours.length ? <dl>{groupedHours(details.hours).map((row, index) => <div key={index}><dt>{row.days}</dt><dd>{row.times}</dd></div>)}</dl> : <p className="platform-demo-review-missing">Not supplied</p>}
          {details.visitInstructions && <p className="platform-demo-review-visits">{details.visitInstructions}</p>}
        </div>
      </div>
      {details.missingFields.length > 0 && <p className="platform-demo-review-business-missing"><strong>Not supplied:</strong> {details.missingFields.join(', ')}. Add confirmed details or leave them out of the demo.</p>}
      {editing && <form ref={editForm} id={`${id}-edit`} className="platform-demo-review-edit" onSubmit={event => void save(event)} aria-busy={saving}>
        <PublicDetailsReview value={draft} sourceUrl={dealer.sourceUrl} disabled={saving} onChange={setDraft} expanded allowRemoval={false}/>
        {saveError && <div role="alert" className="platform-demo-review-warning"><p>{saveError}</p>{saveError.startsWith('This demo changed') && <Button type="button" variant="outline" onClick={() => void load()}>Reload saved details</Button>}</div>}
        <div className="platform-demo-review-edit-actions"><Button type="submit" disabled={saving || !draft || !Object.keys(changedDetails).length}>{saving ? 'Saving…' : 'Save dealership details'}</Button><Button type="button" variant="ghost" disabled={saving} onClick={() => { setEditing(false); editButton.current?.focus(); }}>Cancel</Button></div>
      </form>}
    </section>

    <section className="platform-demo-review-stock" aria-labelledby={`${id}-stock`}>
      <div className="platform-demo-review-section-heading"><div><h3 id={`${id}-stock`}>Stock to review</h3><p>Cars with missing items appear first. Photo counts show saved links, not a check that each image loads.</p></div><Button type="button" variant="outline" onClick={onUploadStock}>Upload corrected stock</Button></div>
      {stock.count === 0 ? <div className="platform-demo-review-empty"><Camera size={26} aria-hidden="true"/><h4>No stock has been saved yet</h4><p>Upload the dealership’s complete stock JSON, then return here to check it.</p><Button type="button" onClick={onUploadStock}>Upload stock JSON</Button></div> : <>
        <div className="platform-demo-review-stock-controls"><div className="platform-demo-review-filters" role="group" aria-label="Filter demo stock">
          {([['all', 'All cars', stock.count], ['photos', 'No photos', stock.noPhotosCount], ['details', 'Missing details', stock.missingInfoCount]] as const).map(([value, label, total]) => <button type="button" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label} <span>{count(total)}</span></button>)}
        </div><label className="platform-demo-review-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search demo stock</span><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search car or reg"/></label></div>
        <p className="sr-only" role="status">{count(rows.length)} {rows.length === 1 ? 'car shown' : 'cars shown'}</p>
        {rows.length ? <ul className="platform-demo-review-vehicles">{rows.map(vehicle => <li key={vehicle.id}>
          <div className="platform-demo-review-photo">{vehicle.photoUrl ? <img src={vehicle.photoUrl} alt={vehicle.title} loading="lazy"/> : <><Camera size={22} aria-hidden="true"/><span>No photos</span></>}</div>
          <div className="platform-demo-review-car"><h4>{vehicle.title}</h4><p><span className={vehicle.registration ? 'platform-demo-review-reg' : 'platform-demo-review-missing'}>{vehicle.registration || 'Reg not supplied'}</span>{vehicle.price !== null && vehicle.price > 0 && <strong>{money(vehicle.price)}</strong>}</p>
            <p className={vehicle.missingPhotos || vehicle.missingFields.length ? 'platform-demo-review-car-issues' : 'platform-demo-review-car-complete'}>{vehicle.missingPhotos || vehicle.missingFields.length ? `Missing: ${[...(vehicle.missingPhotos ? ['Photos'] : []), ...vehicle.missingFields].join(', ')}` : 'Key details supplied'}</p>
          </div>
          <div className="platform-demo-review-car-actions"><span>{count(vehicle.photoCount)} {vehicle.photoCount === 1 ? 'photo link' : 'photo links'}</span>{preview.allowed && <a href={vehicle.previewPath} target="_blank" rel="noopener noreferrer">View car <ExternalLink size={13} aria-hidden="true"/><span className="sr-only"> {vehicle.title} in a new tab</span></a>}</div>
        </li>)}</ul> : <div className="platform-demo-review-empty"><h4>No cars match this view</h4><p>{search ? 'Try a different car name or registration, or clear the filters.' : 'There are no cars with these missing items.'}</p><Button type="button" variant="outline" onClick={() => { setFilter('all'); setSearch(''); }}>Show all cars</Button></div>}
      </>}
    </section>
    <footer className="platform-demo-review-footer"><p>Private demo. No customer emails are sent from this review.</p><span>Expires {date(dealer.expiresAt)}</span></footer>
  </section>;
}
