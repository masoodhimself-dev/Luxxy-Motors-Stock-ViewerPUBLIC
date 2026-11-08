import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { CheckCircle2, ExternalLink, Link2 } from '@/components/icons';
import { Button, buttonVariants } from './ui/button';
import { Input } from './ui/input';
import './platform-demo-from-link.css';

type PrivateDemoResult = {
  dealerId: string;
  dealerName: string;
  previewPath: string;
  received: number;
};

type PendingCollection = { status: 'collecting'; jobId: string };
type DemoCreationResponse = PrivateDemoResult | PendingCollection;
type CollectionResponse = PendingCollection | ({ status: 'ready' } & PrivateDemoResult) | { status: 'failed'; error: string };

const pendingJobKey = 'dealeros:private-demo:pending-collection';
const collectionPath = '/api/platform/demos/collection/';
const pollWindow = 10 * 60 * 1000;

function savedJob() {
  try {
    return sessionStorage.getItem(pendingJobKey);
  } catch {
    return null;
  }
}

function saveJob(jobId: string | null) {
  try {
    if (jobId) sessionStorage.setItem(pendingJobKey, jobId);
    else sessionStorage.removeItem(pendingJobKey);
  } catch {
    // Collection can continue when browser storage is unavailable.
  }
}

function checkedResult(demo: PrivateDemoResult) {
  if (!demo || typeof demo.dealerId !== 'string' || !demo.dealerId
    || typeof demo.dealerName !== 'string' || !demo.dealerName
    || !Number.isInteger(demo.received) || demo.received < 1) {
    throw new Error('Private demo response was incomplete.');
  }
  const preview = `/platform/preview/${encodeURIComponent(demo.dealerId)}`;
  if (demo.previewPath !== preview && demo.previewPath !== `${preview}/stock`) {
    throw new Error('Private demo response was incomplete.');
  }
  return demo;
}

function responseError(cause: unknown, fallback: string) {
  const detail = cause instanceof HttpApiError ? (cause.data as { error?: unknown } | null)?.error : null;
  return typeof detail === 'string' && detail ? detail : fallback;
}

function isAutoTraderLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['autotrader.co.uk', 'www.autotrader.co.uk'].includes(url.hostname)
      && !url.username && !url.password && !url.port;
  } catch {
    return false;
  }
}

export function PlatformDemoFromLink({ busy, onBusyChange, onManage }: {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onManage: (dealerId: string) => void;
}) {
  const id = useId();
  const [link, setLink] = useState('');
  const [creating, setCreating] = useState(false);
  const [jobId, setJobId] = useState(savedJob);
  const [paused, setPaused] = useState(false);
  const [connectionLost, setConnectionLost] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PrivateDemoResult>();
  const previewLink = useRef<HTMLAnchorElement>(null);
  const collecting = creating || Boolean(jobId);

  useEffect(() => {
    if (result) previewLink.current?.focus();
  }, [result]);

  useEffect(() => {
    if (!jobId || paused) return;
    let cancelled = false;
    let timer: number;
    let requestTimeout: number;
    let activeRequest: AbortController | undefined;
    let delay = 1_000;
    const deadline = Date.now() + pollWindow;
    const path = `${collectionPath}${encodeURIComponent(jobId)}`;

    function finishJob() {
      saveJob(null);
      setJobId(null);
      setConnectionLost(false);
    }

    async function check() {
      if (Date.now() >= deadline) {
        setPaused(true);
        return;
      }
      const request = new AbortController();
      activeRequest = request;
      requestTimeout = window.setTimeout(() => request.abort(), 15_000);
      try {
        const status = await customFetch<CollectionResponse>(path, {
          cache: 'no-store',
          signal: request.signal,
        });
        if (cancelled) return;
        if (status.status === 'ready') {
          setResult(checkedResult(status));
          finishJob();
          return;
        }
        if (status.status === 'failed') {
          setError(status.error || 'The stock collection could not finish. Try again or use a stock JSON file.');
          finishJob();
          return;
        }
        if (status.status !== 'collecting' || status.jobId !== jobId) throw new Error('Collection status was incomplete.');
        setConnectionLost(false);
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof HttpApiError && [401, 403, 404, 410].includes(cause.status)) {
          setError(responseError(cause, 'This stock collection is no longer available. Try the link again or use a stock JSON file.'));
          finishJob();
          return;
        }
        setConnectionLost(true);
      } finally {
        window.clearTimeout(requestTimeout);
      }
      if (!cancelled) {
        timer = window.setTimeout(() => void check(), delay);
        delay = Math.min(delay * 2, 10_000);
      }
    }

    timer = window.setTimeout(() => void check(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(requestTimeout);
      activeRequest?.abort();
    };
  }, [jobId, paused]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || collecting) return;
    const sourceUrl = link.trim();
    if (!isAutoTraderLink(sourceUrl)) {
      setInvalidLink(true);
      setError('Paste an HTTPS stock link from autotrader.co.uk.');
      return;
    }
    setInvalidLink(false);
    setError('');
    setCreating(true);
    onBusyChange(true);
    try {
      const demo = await customFetch<DemoCreationResponse>('/api/platform/demos/from-autotrader', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl }),
      });
      if ('jobId' in demo) {
        if (demo.status !== 'collecting' || typeof demo.jobId !== 'string' || !demo.jobId) {
          throw new Error('Missing collection job.');
        }
        saveJob(demo.jobId);
        setJobId(demo.jobId);
        setPaused(false);
        return;
      }
      setResult(checkedResult(demo));
    } catch (cause) {
      setError(responseError(cause, 'Could not confirm the private demo. Try the same link again or use a stock JSON file.'));
    } finally {
      setCreating(false);
      onBusyChange(false);
    }
  }

  if (result) return <section className="platform-demo-from-link" aria-labelledby={`${id}-heading`}>
    <div role="status" className="platform-demo-link-intro">
      <span className="platform-demo-link-icon"><CheckCircle2 size={18} aria-hidden="true"/></span>
      <div>
        <h3 id={`${id}-heading`}>{result.dealerName} is ready to show</h3>
        <p>{result.received.toLocaleString('en-GB')} {result.received === 1 ? 'vehicle' : 'vehicles'} imported into the private demo.</p>
      </div>
    </div>
    <div className="platform-demo-link-actions">
      <a className={buttonVariants()} ref={previewLink} href={result.previewPath} target="_blank" rel="noopener noreferrer">
        Open private preview <ExternalLink size={16} aria-hidden="true"/><span className="sr-only"> in a new tab</span>
      </a>
      <Button type="button" variant="outline" onClick={() => onManage(result.dealerId)}>Manage demo</Button>
      <Button type="button" variant="ghost" onClick={() => {
        setLink('');
        setResult(undefined);
      }}>Create another demo</Button>
    </div>
  </section>;

  return <section className="platform-demo-from-link" aria-labelledby={`${id}-heading`}>
    <div className="platform-demo-link-intro">
      <span className="platform-demo-link-icon"><Link2 size={18} aria-hidden="true"/></span>
      <div>
        <h3 id={`${id}-heading`}>Start with an Auto Trader link</h3>
        <p id={`${id}-help`}>Paste the dealer’s stock page. Only signed-in platform admins can open the preview.</p>
      </div>
    </div>
    <form className="platform-demo-link-form" onSubmit={event => void create(event)} aria-busy={collecting && !paused}>
      <label className="platform-field">
        <span>Auto Trader stock link</span>
        <Input type="text" inputMode="url" autoComplete="off" spellCheck={false} maxLength={2048}
          value={link} placeholder="https://www.autotrader.co.uk/dealers/…"
          aria-describedby={invalidLink ? `${id}-help ${id}-error` : `${id}-help`}
          aria-invalid={invalidLink || undefined} disabled={busy || collecting}
          onChange={event => {
            setLink(event.target.value);
            setInvalidLink(false);
            setError('');
          }}/>
      </label>
      <Button type="submit" disabled={busy || collecting || !link.trim()}>
        {collecting ? 'Creating private demo…' : 'Create private demo'}
      </Button>
    </form>
    {collecting && <p className="platform-demo-link-progress" role="status">
      {paused ? 'The stock collection is taking longer than usual.'
        : connectionLost ? 'Waiting to reconnect and check the stock collection…'
        : 'Collecting and importing the dealership’s stock…'}
    </p>}
    {jobId && paused && <div className="platform-demo-link-actions">
      <Button type="button" variant="outline" onClick={() => setPaused(false)}>Check collection status</Button>
    </div>}
    {error && <p className="platform-demo-link-error" id={`${id}-error`} role="alert">{error}</p>}
  </section>;
}
