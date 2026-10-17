import { useEffect, useState } from 'react';
import { Activity, AlertCircle, ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import './platform-capacity.css';

type DealerImport = {
  dealerId: string; name: string; connectionConfigured: boolean;
  freshness: 'fresh' | 'warning' | 'critical' | 'missing'; ageSeconds: number | null;
  lastSuccessfulCollectionAt: string | null; lastSuccessfulImportAt: string | null;
  lastAttemptAt: string | null; lastAttemptStatus: string | null; needsAttention: boolean;
};
export type PlatformCapacityData = {
  generatedAt: string; scope: 'this_process' | 'local_fixture';
  database: { ready: boolean; pool: { maximum: number; total: number; idle: number; waiting: number; idleErrorCount: number; lastIdleErrorAt: string | null } };
  imports: {
    admission: { active: number; maximum: number; accepted: number; rejected: number; completed: number; oldestActiveMs: number };
    available: boolean; dealerCount?: number; attentionCount?: number; missingConnectionCount?: number;
    neverImportedCount?: number; warningCount?: number; criticalCount?: number; dealers?: DealerImport[];
  };
  jobs: {
    concurrency: number; activeDealerJobs: number; queuedDealerJobs: number;
    sweeps: { name: string; state: 'running' | 'completed' | 'failed'; startedAt: string; finishedAt: string | null; durationMs: number; dealers: number; completed: number; failed: number; excludedDemos: number; maxActive: number }[];
  };
};
const time = (value: string | null) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(value)) : 'Not yet';
function age(seconds: number | null) {
  if (seconds === null) return 'No successful import';
  if (seconds < 60) return 'Just checked';
  const hours = Math.floor(seconds / 3_600), minutes = Math.floor(seconds % 3_600 / 60);
  return `${hours ? `${hours}h ` : ''}${minutes}m since collection`;
}
function status(dealer: DealerImport) {
  if (!dealer.connectionConfigured) return 'Import credential missing';
  if (dealer.freshness === 'missing') return 'First import needed';
  if (dealer.freshness === 'critical') return 'Stock overdue · 14h+';
  if (dealer.freshness === 'warning') return 'Stock due soon · 13h+';
  if (dealer.lastAttemptStatus === 'failed') return 'Last import failed';
  if (dealer.lastAttemptStatus === 'quarantined') return 'Last import held for review';
  return 'Stock up to date';
}

/** Mounted only after the platform overview has confirmed administrator access. */
export function PlatformCapacity({ onOpenDealer }: { onOpenDealer: (dealerId: string) => void }) {
  const [data, setData] = useState<PlatformCapacityData | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void customFetch<PlatformCapacityData>('/api/platform/capacity', { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (!result?.database?.pool || !result.imports?.admission || !Array.isArray(result.jobs?.sweeps) || (result.imports.available && !Array.isArray(result.imports.dealers))) throw new Error('Invalid capacity snapshot');
      setData(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Could not check platform operations. Refresh to try again.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const dealers = data?.imports.dealers ?? [];
  const attention = dealers.filter(dealer => dealer.needsAttention);
  function dealerRows(rows: DealerImport[]) {
    return <ul className="platform-capacity-dealers">{rows.map(dealer => <li key={dealer.dealerId}>
      <div><strong>{dealer.name}</strong><span className={dealer.needsAttention ? 'is-attention' : 'is-healthy'}>{status(dealer)}</span><small>{age(dealer.ageSeconds)}{dealer.lastAttemptStatus ? ` · Latest attempt: ${dealer.lastAttemptStatus}` : ''}</small><small>Last received: {time(dealer.lastSuccessfulImportAt)}</small></div>
      <Button variant="ghost" size="sm" onClick={() => onOpenDealer(dealer.dealerId)} aria-label={`Open ${dealer.name}`}>Open <ArrowRight size={15} aria-hidden="true"/></Button>
    </li>)}</ul>;
  }
  return <section className="platform-panel platform-capacity" aria-label="Platform operations" aria-busy={loading}>
    <div className="platform-section-heading"><div><h2><Activity size={20} aria-hidden="true"/>Platform operations</h2><p>Current service snapshot. Use load testing to establish capacity before adding many dealers.</p></div><Button variant="outline" size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} aria-hidden="true"/>Refresh operations</Button></div>
    {loading && !data && <p role="status">Checking platform operations…</p>}
    {error && <p role="alert" className="platform-capacity-error">{error}{data ? ' The previous snapshot is shown below.' : ''}</p>}
    {data && <>
      {data.scope === 'local_fixture' && <p className="platform-capacity-sample">Fictional local sample for layout review. These figures do not describe your live platform; no database or delivery service was contacted.</p>}
      <div className="platform-capacity-cards">
        <article><h3>Database</h3><strong className={data.database.ready ? 'is-healthy' : 'is-attention'}>{data.database.ready ? <CheckCircle2 size={17} aria-hidden="true"/> : <AlertCircle size={17} aria-hidden="true"/>}{data.database.ready ? 'Responding' : 'Needs attention'}</strong><p>{data.database.pool.total} / {data.database.pool.maximum} connections · {data.database.pool.waiting} waiting</p><small>{data.database.pool.idle} idle{data.database.pool.idleErrorCount ? ` · ${data.database.pool.idleErrorCount} discarded idle connection errors` : ''}</small></article>
        <article><h3>Stock imports</h3><strong>{data.imports.admission.active} / {data.imports.admission.maximum} running</strong><p>{data.imports.admission.completed} requests finished · {data.imports.admission.rejected} deferred when busy</p><small>{data.imports.admission.oldestActiveMs ? `Longest current request: ${(data.imports.admission.oldestActiveMs / 1_000).toFixed(1)}s` : 'No import in progress'}</small></article>
        <article><h3>Background work</h3><strong>{data.jobs.activeDealerJobs} / {data.jobs.concurrency} running</strong><p>{data.jobs.queuedDealerJobs} dealership checks waiting</p><small>{data.jobs.sweeps.some(sweep => sweep.state === 'failed') ? 'A recent sweep needs review below.' : 'Bounded work across active dealerships'}</small></article>
      </div>
      <div className="platform-capacity-freshness"><h3>Stock freshness</h3><p>Active live dealerships only. A collection reaches the warning after 13 hours and becomes overdue after 14 hours.</p>
        {!data.imports.available ? <p className="platform-capacity-error">Stock freshness could not be checked. Refresh once the database is responding.</p> : <>
          <p className="platform-capacity-counts">{data.imports.dealerCount} live dealerships · {data.imports.criticalCount} overdue · {data.imports.warningCount} due soon · {data.imports.missingConnectionCount} without an import credential</p>
          {attention.length ? dealerRows(attention) : <p className="platform-capacity-healthy"><CheckCircle2 size={17} aria-hidden="true"/>{dealers.length ? 'All connected dealers have fresh stock and no failed latest import.' : 'No active live dealerships yet.'}</p>}
          {dealers.length > attention.length && <details><summary>Other live dealerships ({dealers.length - attention.length})</summary>{dealerRows(dealers.filter(dealer => !dealer.needsAttention))}</details>}
        </>}
      </div>
      <details className="platform-capacity-sweeps"><summary>Recent background sweeps ({data.jobs.sweeps.length})</summary>{data.jobs.sweeps.length ? <ul>{data.jobs.sweeps.map(sweep => <li key={sweep.name}><div><strong>{sweep.name.replace(/-/g, ' ')}</strong><span className={sweep.state === 'failed' ? 'is-attention' : ''}>{sweep.state}</span></div><p>{sweep.completed} / {sweep.dealers} checks completed · {sweep.failed} failed · {(sweep.durationMs / 1_000).toFixed(1)}s</p><small>{sweep.state === 'running' ? 'Started' : 'Finished'} {time(sweep.finishedAt ?? sweep.startedAt)}</small></li>)}</ul> : <p>No worker sweep has been recorded since this service started.</p>}</details>
      <p className="platform-capacity-footnote">{data.scope === 'local_fixture' ? 'Fictional examples only. Refreshing this local sample does not run jobs or change any dealership.' : <>Checked {time(data.generatedAt)} (UK). Pool use, import request counters and background sweeps describe this process. Request counters and sweeps reset on restart; stock history persists. This snapshot is not a capacity certification. Refresh manually for the latest view.</>}</p>
    </>}
  </section>;
}
