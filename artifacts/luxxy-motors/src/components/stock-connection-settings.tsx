import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import type { StockConnection } from '@workspace/vehicle-meta';
import { privateSettingsSaved, usePrivateSettingsRefresh, type PrivateSettingsSave } from '@/lib/private-settings-sync';
type State = { revision: number; shared?: boolean; connection: StockConnection; importSecretConfigured?: boolean; fixtureOnly?: boolean; latest?: { status: string; receivedAt: string; count: number } | null };
export function StockConnectionSettings() {
  const [state, setState] = useState<State>();
  const [savedConnection, setSavedConnection] = useState('');
  const [denied, setDenied] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const snapshot = (value: State) => JSON.stringify(value.connection);
  const changed = Boolean(state && snapshot(state) !== savedConnection);
  const current = useRef({state,savedConnection,changed}); current.current={state,savedConnection,changed};
  async function load(preserveDraft = false, saved?:PrivateSettingsSave) { try {
    const loaded=await customFetch<State>('/api/dealer-integrations/stock-connection'), latest=current.current;
    if (!preserveDraft || !latest.state || !latest.changed) {setState(loaded);setSavedConnection(snapshot(loaded));}
    else if(latest.state.revision===saved?.previousRevision&&loaded.revision===saved.savedRevision&&snapshot(loaded)===latest.savedConnection) setState({...loaded,connection:latest.state.connection});
    setDenied(false);setError('');
  } catch (cause) { const status = (cause as { status?: number }).status; if (status === 403) { setDenied(true); setState(undefined); } else setError('Unable to load operator stock settings.'); } }
  useEffect(() => { void load(); }, []);
  usePrivateSettingsRefresh('stock',saved=>denied?undefined:load(true,saved));
  if (denied || (!state && !error)) return null;
  async function save() { if (!state) return; setBusy(true); setError(''); setNotice(''); try { const result = await customFetch<State>('/api/dealer-integrations/stock-connection', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: state.revision, connection: state.connection }) }); const saved={ ...state, ...result };setState(saved);setSavedConnection(snapshot(saved));await privateSettingsSaved('stock',state.revision,result.revision);setNotice('Stock connection saved. Configure Grok with the same retailer reference.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Stock connection could not be saved.'); } finally { setBusy(false); } }
  const update = (patch: Partial<StockConnection>) => state && setState({ ...state, connection: { ...state.connection, ...patch } });
  return <section className="integration-card mt-6" aria-label="Platform stock connection" data-settings-dirty={changed}><div className="integration-card-heading"><div><h3>Stock connection</h3><p>Platform administrator only · one active marketplace</p></div></div>
    {error && <p role="alert" className="integration-error">{error}</p>}{notice && <p role="status" className="integration-notice">{notice}</p>}
    {state && <><div className="integration-field"><label htmlFor="stock-platform">Marketplace</label><NativeSelect id="stock-platform" value={state.connection.platform} disabled={busy || state.fixtureOnly || state.shared} onChange={e => update({ platform: e.target.value as StockConnection['platform'] })}><option value="autotrader">Auto Trader</option><option value="cazoo">Cazoo</option></NativeSelect></div>
      <div className="integration-field"><label htmlFor="stock-retailer">Retailer reference</label><Input id="stock-retailer" value={state.connection.retailerId} disabled={busy || state.fixtureOnly || state.shared} onChange={e => update({ retailerId: e.target.value })} /><small>Must exactly match retailerId in the Grok snapshot.</small></div>
      <div className="integration-field"><label htmlFor="stock-source-url">Authorised stock page</label><Input id="stock-source-url" type="url" value={state.connection.sourceUrl} disabled={busy || state.fixtureOnly} onChange={e => update({ sourceUrl: e.target.value })} /></div>
      <label className="integration-check"><input type="checkbox" checked={state.connection.enabled} disabled={busy || state.fixtureOnly} onChange={e => update({ enabled: e.target.checked })} /> Accept automatic stock imports</label>
      <p className="integration-footnote">Missing descriptions publish automatically using supplied facts. Original advert text takes priority. Missing equipment and history stay hidden.</p>
      <p className="integration-readiness">{state.fixtureOnly ? 'This local server displays fixed fixtures; connection changes are available on the real backend.' : state.importSecretConfigured ? 'Import credential configured securely on the server.' : state.shared ? 'Issue this dealership an import key through platform administration before connecting Grok.' : 'Set STOCK_IMPORT_SECRET securely on the server before connecting Grok.'}</p>
      {state.latest && <p className="integration-readiness">Last received: {new Date(state.latest.receivedAt).toLocaleString('en-GB')} · {state.latest.count} cars · {state.latest.status}</p>}
      <p className="integration-footnote">Changing an existing dealership’s marketplace or retailer requires a reviewed migration to preserve linked records.</p>
      <div className="integration-actions"><Button disabled={busy || state.fixtureOnly || !changed} onClick={() => void save()}>Save stock connection</Button><Button variant="ghost" disabled={busy} onClick={() => {if(!changed||window.confirm('Discard unsaved stock connection changes and reload?'))void load();}}>Reload</Button></div>
    </>}
  </section>;
}
