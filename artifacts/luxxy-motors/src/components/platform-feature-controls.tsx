import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import type { DealerFeatureState, FeatureMode, FeatureRule } from '@workspace/vehicle-meta';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import './platform-feature-controls.css';

type Policy = { readOnly?: boolean; scope: 'platform' | 'dealer'; dealerId: string | null; evaluatedAt: string; features: DealerFeatureState[]; audit: Array<{ id: string; featureKey: string; reason: string; actor: string; createdAt: string; after: FeatureRule }> };
type Draft = { mode: FeatureMode; disabledAt: string; reason: string };
const localDate = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const dateLabel = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function PlatformFeatureControls({ dealerId }: { dealerId?: string }) {
  const endpoint = `/api/platform${dealerId ? `/dealers/${encodeURIComponent(dealerId)}` : ''}/features`;
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const latestEndpoint = useRef(endpoint);
  const requestVersion = useRef(0);
  latestEndpoint.current = endpoint;
  async function load() {
    const version = ++requestVersion.current;
    const current = () => latestEndpoint.current === endpoint && requestVersion.current === version;
    setLoading(true); setFresh(false); setError('');
    try { const response = await customFetch<Policy>(endpoint); if (current()) { setPolicy(response); setFresh(true); } }
    catch { if (current()) setError('Feature controls could not be loaded. Your saved settings have not changed.'); }
    finally { if (current()) setLoading(false); }
  }
  useEffect(() => { setPolicy(null); setDrafts({}); setNotice(''); setBusy(null); void load(); return () => { requestVersion.current++; }; }, [endpoint]);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  async function save(feature: DealerFeatureState, draft: Draft) {
    if (busy || !fresh || policy?.readOnly || loading) return;
    const version = ++requestVersion.current;
    const current = () => latestEndpoint.current === endpoint && requestVersion.current === version;
    const rule = dealerId ? feature.rule : feature.platformRule;
    setBusy(feature.key); setError(''); setNotice('');
    try {
      const disabledAt = draft.disabledAt && draft.mode !== 'disabled' ? new Date(draft.disabledAt).toISOString() : null;
      const updated = await customFetch<Policy>(`${endpoint}/${feature.key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: draft.mode, disabledAt, reason: draft.reason.trim(), expectedRevision: rule.revision }) });
      if (!current()) return;
      setPolicy(updated);
      setDrafts(current => { const next = { ...current }; delete next[feature.key]; return next; });
      setNotice(`${feature.label} controls saved.${disabledAt ? ` Automatic switch-off: ${dateLabel(disabledAt)}.` : ''}`);
    } catch (cause) {
      if (!current()) return;
      const message = cause && typeof cause === 'object' && 'data' in cause && cause.data && typeof cause.data === 'object' && 'error' in cause.data ? String(cause.data.error) : 'Feature controls could not be saved. Reload to check the latest policy before retrying.';
      setError(message);
    } finally { if (current()) setBusy(null); }
  }
  return <section className="platform-feature-controls" aria-labelledby={`feature-heading-${dealerId || 'platform'}`}>
    <div className="platform-section-heading"><div><h2 id={`feature-heading-${dealerId || 'platform'}`}>{dealerId ? 'Dealership features' : 'Platform feature defaults'}</h2><p>{dealerId ? 'Use the platform default, or choose an explicit setting for this dealership.' : 'These defaults apply to dealerships that inherit them. Explicit dealer overrides are preserved.'}</p></div><Button type="button" variant="outline" disabled={loading || !!busy} onClick={() => void load()}>Reload controls</Button></div>
    <p className="platform-help">Turning a feature off stops new actions. Existing records stay available. Optional switch-off dates are enforced by the server, even when this page is closed. Release restrictions always take priority.</p>
    {error && <p role="alert" className="platform-alert">{error}</p>}
    {notice && <p role="status" className="platform-notice">{notice}</p>}
    {loading && !policy && <p role="status">Loading feature controls…</p>}
    {policy && <>{policy.readOnly && <p className="platform-notice">Local layout preview. Feature changes require the configured platform backend.</p>}<p className="platform-feature-updated">Checked {dateLabel(policy.evaluatedAt)} · Dates use {zone}</p>
      <div className="platform-feature-list">{policy.features.map(feature => {
        const rule = dealerId ? feature.rule : feature.platformRule;
        const draft = drafts[feature.key] ?? { mode: rule.mode, disabledAt: localDate(rule.disabledAt), reason: '' };
        const update = (change: Partial<Draft>) => setDrafts(current => ({ ...current, [feature.key]: { ...draft, ...change } }));
        const enabled = dealerId ? feature.enabled : feature.inheritedEnabled;
        return <form key={feature.key} className="platform-feature-row" onSubmit={event => { event.preventDefault(); void save(feature, draft); }}>
          <div className="platform-feature-description"><h3>{feature.label}</h3><p>{feature.description}</p><span className={`platform-feature-status ${enabled ? 'is-enabled' : ''}`}>{feature.releaseEnabled ? enabled ? 'Currently on' : 'Currently off' : 'Release restricted'}</span>{dealerId && feature.releaseEnabled && <small>Platform default: {feature.inheritedEnabled ? 'on' : 'off'}</small>}{rule.disabledAt && <small>Switch-off: {dateLabel(rule.disabledAt)}</small>}</div>
          {feature.releaseEnabled ? <fieldset disabled={!!busy || policy.readOnly || !fresh || loading} className="platform-feature-fields"><legend className="sr-only">Controls for {feature.label}</legend>
            <label><span>Availability</span><NativeSelect aria-label={`${feature.label} availability`} value={draft.mode} onChange={event => update({ mode: event.target.value as FeatureMode, ...(event.target.value === 'disabled' ? { disabledAt: '' } : {}) })}>{dealerId && <option value="inherit">Use platform default</option>}<option value="enabled">Enabled</option><option value="disabled">Disabled</option></NativeSelect></label>
            <label><span>Switch off automatically (optional)</span><Input aria-label={`${feature.label} switch-off date`} type="datetime-local" disabled={draft.mode === 'disabled'} value={draft.disabledAt} onChange={event => update({ disabledAt: event.target.value })}/></label>
            <label className="platform-feature-reason"><span>Reason for this change</span><Input aria-label={`${feature.label} reason`} value={draft.reason} minLength={3} maxLength={1000} required placeholder="For example: trial ends or dealer request" onChange={event => update({ reason: event.target.value })}/></label>
            <Button type="submit" disabled={draft.reason.trim().length < 3}>{busy === feature.key ? 'Saving…' : dealerId ? 'Save dealer setting' : 'Save default'}</Button>
          </fieldset> : <p className="platform-help">This feature cannot be enabled through a platform or dealer override.</p>}
        </form>;
      })}</div>
      <details className="platform-feature-audit"><summary>Recent feature changes ({policy.audit.length})</summary>{policy.audit.length ? <ol>{policy.audit.map(entry => <li key={entry.id}><strong>{policy.features.find(feature => feature.key === entry.featureKey)?.label || entry.featureKey} · {entry.after.mode}</strong><p>{entry.reason}</p><small>{dateLabel(entry.createdAt)} · {entry.actor}</small></li>)}</ol> : <p>No feature overrides have been changed for this scope.</p>}</details>
    </>}
  </section>;
}
