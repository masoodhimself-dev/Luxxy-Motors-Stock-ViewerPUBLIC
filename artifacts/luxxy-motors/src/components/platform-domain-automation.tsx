import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { AlertCircle, CheckCircle2, Globe2, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import './platform-domain-automation.css';

export type DomainJob = {
  id: string;
  hostname: string;
  status: 'queued' | 'running' | 'waiting' | 'blocked' | 'completed';
  stage: string;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt: string | null;
  history: { at: string; stage: string; status: string; message?: string }[];
};
type DomainSetup = { configured: boolean; reason: string; jobs: DomainJob[] };
const active = (job: DomainJob) => ['queued', 'running', 'waiting'].includes(job.status);
const stageLabels: Record<string, string> = {
  queued: 'Waiting to start', preflight: 'Checking the domain', cloudflare_zone: 'Finding the Cloudflare zone',
  ownership: 'Verifying domain ownership', dns: 'Connecting DNS', render_domain: 'Adding the domain in Render',
  render_verification: 'Verifying the Render connection', certificate: 'Checking HTTPS', completed: 'Domain connected',
  render: 'Adding the domain in Render', https: 'Checking HTTPS', complete: 'Domain connected',
};
const stageLabel = (stage: string) => stageLabels[stage] ?? stage.replace(/[_-]+/g, ' ').replace(/^./, value => value.toUpperCase());
const time = (value: string) => new Date(value).toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });
function hostnameFromInput(value: string) {
  let hostname = value.trim().toLowerCase();
  if (hostname.includes('://')) {
    const url = new URL(hostname);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error();
    hostname = url.hostname;
  }
  hostname = hostname.replace(/\.$/, '');
  if (hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) throw new Error();
  return hostname;
}

export function PlatformDomainAutomation({ dealerId, onUpdated }: { dealerId: string; onUpdated: () => void }) {
  const [data, setData] = useState<DomainSetup | null>(null);
  const [hostname, setHostname] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [queryError, setQueryError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const onUpdatedRef = useRef(onUpdated);
  onUpdatedRef.current = onUpdated;
  const seenStatuses = useRef(new Map<string, string>());
  const knownJobs = useRef<DomainJob[]>([]);
  const queryAbort = useRef<AbortController | null>(null);
  const mutationAbort = useRef<AbortController | null>(null);
  const mutationBusy = useRef(false);
  const identity = useRef(dealerId);
  const base = `/api/platform/dealers/${encodeURIComponent(dealerId)}/domain-automation`;

  function recordJobs(jobs: DomainJob[], includeNew = false) {
    knownJobs.current = jobs;
    let completed = false;
    for (const job of jobs) {
      const previous = seenStatuses.current.get(job.id);
      if (job.status === 'completed' && previous !== 'completed' && (previous !== undefined || includeNew)) completed = true;
      seenStatuses.current.set(job.id, job.status);
    }
    if (completed) onUpdatedRef.current();
  }

  useEffect(() => {
    identity.current = dealerId;
    seenStatuses.current.clear();
    knownJobs.current = [];
    setData(null); setHostname(''); setError(''); setQueryError(''); setLoading(true); setBusy(false);
    mutationBusy.current = false;
    return () => { mutationAbort.current?.abort(); queryAbort.current?.abort(); };
  }, [dealerId]);

  useEffect(() => {
    if (busy) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    queryAbort.current = controller;
    async function read() {
      try {
        const result = await customFetch<DomainSetup>(base, { signal: controller.signal });
        if (!mounted || controller.signal.aborted) return;
        if (!result || typeof result.configured !== 'boolean' || !Array.isArray(result.jobs)) throw new Error('Domain setup status is unavailable. Refresh to try again.');
        setData(result); setQueryError(''); recordJobs(result.jobs);
        if (result.jobs.some(active)) timer = setTimeout(() => void read(), 15_000);
      } catch (cause) {
        if (!mounted || controller.signal.aborted) return;
        setQueryError(cause instanceof Error ? cause.message : 'Could not check domain setup. Refresh to try again.');
        // A failed status check must not start or retry a setup job.
        if (knownJobs.current.some(active)) timer = setTimeout(() => void read(), 15_000);
      } finally {
        if (mounted && !controller.signal.aborted) setLoading(false);
      }
    }
    void read();
    return () => { mounted = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [base, busy, refresh]);

  async function write(path: string, body: unknown) {
    if (mutationBusy.current) return;
    mutationBusy.current = true;
    queryAbort.current?.abort();
    const controller = new AbortController();
    mutationAbort.current = controller;
    const currentDealer = dealerId;
    setBusy(true); setError('');
    try {
      const result = await customFetch<{ job: DomainJob }>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      if (controller.signal.aborted || identity.current !== currentDealer) return;
      if (!result?.job?.id || !result.job.status) throw new Error('The setup request could not be confirmed. Refresh status before trying again.');
      setData(old => ({ configured: old?.configured ?? true, reason: old?.reason ?? '', jobs: [result.job, ...(old?.jobs ?? []).filter(job => job.id !== result.job.id)] }));
      recordJobs([result.job], true);
      setHostname('');
    } catch (cause) {
      if (controller.signal.aborted || identity.current !== currentDealer) return;
      setError(cause instanceof Error ? cause.message : 'Could not start domain setup.');
    } finally {
      if (!controller.signal.aborted && identity.current === currentDealer) { mutationBusy.current = false; setBusy(false); setRefresh(value => value + 1); }
    }
  }

  function start(event: React.FormEvent) {
    event.preventDefault();
    try { void write(base, { hostname: hostnameFromInput(hostname) }); }
    catch { setError('Enter a domain such as dealer.co.uk, without a port or page path.'); }
  }

  return <section className="platform-domain-auto" aria-label="Automatic domain setup" aria-busy={busy}>
    <div className="platform-domain-auto-heading"><Globe2 aria-hidden="true" size={24}/><div><h2>Connect domain automatically</h2><p>Enter the dealer’s domain to set up its DNS and Render HTTPS connection.</p></div></div>
    <p className="platform-domain-auto-scope">The domain must be in a Cloudflare zone available to the platform’s configured token. For a root domain, its www address is connected too. Existing website records are checked first; conflicting records stop setup for review.</p>
    {loading && <p role="status" className="platform-domain-auto-loading"><LoaderCircle size={16} aria-hidden="true"/>Checking domain setup…</p>}
    {(error || queryError) && <div role="alert" className="platform-domain-auto-error"><AlertCircle size={18} aria-hidden="true"/><span>{error || queryError}</span></div>}
    {data && !data.configured && <div className="platform-domain-auto-hint"><strong>Secure connections are needed</strong><p>Connect Cloudflare and Render in secure server settings first. Manual DNS setup remains available.</p>{data.reason && <p>{data.reason}</p>}</div>}
    <form onSubmit={start} className="platform-domain-auto-form"><label htmlFor="automatic-domain-hostname">Dealer’s domain<Input id="automatic-domain-hostname" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url" maxLength={253} value={hostname} placeholder="dealer.co.uk" disabled={!data?.configured || busy || loading} onChange={event => setHostname(event.target.value)}/></label><Button type="submit" disabled={!data?.configured || busy || loading || !hostname.trim()}>{busy ? 'Starting setup…' : 'Connect domain'}</Button></form>
    <div className="platform-domain-auto-jobs-heading"><h3>Connection progress</h3><Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} aria-hidden="true"/>Refresh status</Button></div>
    {data && data.jobs.length === 0 && <p className="platform-domain-auto-empty">No automatic domain connections yet.</p>}
    <div className="platform-domain-auto-jobs">{data?.jobs.map(job => <article className={`platform-domain-auto-job is-${job.status}`} key={job.id} aria-label={`Domain setup for ${job.hostname}`}>
      <div className="platform-domain-auto-job-top"><strong>{job.hostname}</strong><span className={`platform-domain-auto-badge is-${job.status}`}>{job.status === 'completed' ? <CheckCircle2 size={14} aria-hidden="true"/> : job.status === 'blocked' ? <AlertCircle size={14} aria-hidden="true"/> : <LoaderCircle size={14} aria-hidden="true"/>}{job.status === 'blocked' ? 'Needs attention' : job.status === 'completed' ? 'Connected' : job.status === 'waiting' ? 'Waiting for verification' : job.status === 'running' ? 'Connecting' : 'Queued'}</span></div>
      <p className="platform-domain-auto-current">{stageLabel(job.stage)}</p>
      {job.error && <p className="platform-domain-auto-job-error">{job.error}</p>}
      {job.status === 'completed' && <p className="platform-domain-auto-success">DNS and Render verification completed. Check staff sign-in before launch.</p>}
      <p className="platform-domain-auto-meta">Updated {time(job.updatedAt)}{job.nextAttemptAt && active(job) ? ` · Next check ${time(job.nextAttemptAt)}` : ''}</p>
      {job.history.length > 0 && <details className="platform-domain-auto-history"><summary>View setup steps</summary><ol>{job.history.map((entry, index) => <li key={`${entry.at}-${index}`}><span className={`platform-domain-auto-dot is-${entry.status}`} aria-hidden="true"/><div><strong>{stageLabel(entry.stage)}</strong>{entry.message && <p>{entry.message}</p>}<time dateTime={entry.at}>{time(entry.at)}</time></div></li>)}</ol></details>}
      {job.status === 'blocked' && <Button type="button" variant="outline" disabled={busy} onClick={() => void write(`${base}/${encodeURIComponent(job.id)}/retry`, {})}>Retry setup for {job.hostname}</Button>}
    </article>)}</div>
    <p className="platform-domain-auto-footer">This connects the domain only. It does not activate the dealership, convert a demo, change email settings or confirm Clerk sign-in.</p>
  </section>;
}
