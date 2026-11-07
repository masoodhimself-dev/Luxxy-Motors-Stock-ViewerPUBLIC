import { useLayoutEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Link, useParams } from 'wouter';
import { Mail } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { usePageMeta } from '@/hooks/use-page-meta';
import { captureStockAlertToken, clearStockAlertToken, stockAlertTokenFromBrowser } from '@/lib/stock-alert-token';

const actions = {
  confirm: {
    title: 'Confirm your stock alert',
    detail: 'We’ll email you when a car matches your search for 60 days. This replaces any existing alert you have with this dealership.',
    button: 'Confirm alert',
    success: 'Your stock alert is active.',
  },
  stop: {
    title: 'Stop your stock alert',
    detail: 'Stop emails about cars that match this search.',
    button: 'Stop alert',
    success: 'Your stock alert has been stopped.',
  },
  renew: {
    title: 'Renew your stock alert',
    detail: 'Keep getting emails about matching cars for another 60 days.',
    button: 'Renew alert',
    success: 'Your stock alert has been renewed.',
  },
};

export default function StockAlertAction() {
  const { action = '' } = useParams<{ action: string }>();
  const details = Object.hasOwn(actions, action) ? actions[action as keyof typeof actions] : undefined;
  const [token, setToken] = useState(stockAlertTokenFromBrowser);
  const [phase, setPhase] = useState<'ready' | 'saving' | 'done' | 'invalid' | 'error'>('ready');
  const [preview, setPreview] = useState<{ stopToken: string; renewToken: string }>();
  const requestRef = useRef<AbortController | null>(null);

  usePageMeta({
    title: 'Stock alerts',
    description: 'Manage your stock alert.',
    indexable: false,
  });
  useLayoutEffect(() => {
    captureStockAlertToken();
    const onLink = () => {
      if (!window.location.hash) return;
      requestRef.current?.abort();
      setToken(stockAlertTokenFromBrowser());
      captureStockAlertToken();
      setPhase('ready');
      setPreview(undefined);
    };
    window.addEventListener('hashchange', onLink);
    return () => {
      window.removeEventListener('hashchange', onLink);
      requestRef.current?.abort();
      clearStockAlertToken();
    };
  }, []);

  async function save() {
    if (!details || !token || (phase !== 'ready' && phase !== 'error')) return;
    const request = new AbortController();
    requestRef.current = request;
    setPhase('saving');
    try {
      const result = await customFetch<{ preview?: boolean; stopToken?: string; renewToken?: string } | null>(`/api/stock-alerts/${action}`, {
        method: 'POST',
        body: JSON.stringify({ token }),
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      if (result?.preview === true && result.stopToken && result.renewToken) {
        setPreview({ stopToken: result.stopToken, renewToken: result.renewToken });
      }
      clearStockAlertToken();
      setPhase('done');
    } catch (cause) {
      if (request.signal.aborted) return;
      const status = (cause as { status?: number } | null)?.status;
      setPhase(status === 400 || status === 404 || status === 410 ? 'invalid' : 'error');
    }
  }

  const invalid = !details || !token || phase === 'invalid';
  return (
    <div className="container mx-auto min-h-[48vh] px-4 py-12 sm:px-6 sm:py-16">
      <section aria-labelledby="stock-alert-title" className="mx-auto max-w-xl rounded-md border border-border bg-card p-6 sm:p-8">
        <Mail size={24} aria-hidden="true" className="mb-4 text-primary" />
        <h1 id="stock-alert-title" className="text-2xl font-bold tracking-tight text-foreground">{details?.title ?? 'Stock alerts'}</h1>
        {invalid ? (
          <p role="status" className="mt-3 text-sm leading-6 text-muted-foreground">This link has expired or is invalid. You can set up an alert from the stock page.</p>
        ) : phase === 'done' ? (
          <p role="status" className="mt-3 text-sm leading-6 text-foreground">{details.success}</p>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{details.detail}</p>
        )}
        {phase === 'error' && (
          <p role="alert" className="mt-3 text-sm leading-6 text-destructive">We couldn’t update your alert. Please try again.</p>
        )}
        {preview && phase === 'done' && (
          <div className="mt-3 text-sm leading-6 text-muted-foreground">
            <p>Local preview. No emails are sent.</p>
            {action !== 'stop' && (
              <div className="flex flex-wrap gap-x-4">
                <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={`/stock-alerts/stop#token=${encodeURIComponent(preview.stopToken)}`}>Open sample stop link</a>
                <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={`/stock-alerts/renew#token=${encodeURIComponent(preview.renewToken)}`}>Open sample renewal link</a>
              </div>
            )}
          </div>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {!invalid && phase !== 'done' && (
            <Button type="button" onClick={() => void save()} disabled={phase === 'saving'}>
              {phase === 'saving' ? 'Saving…' : details.button}
            </Button>
          )}
          <Button asChild variant="outline"><Link href="/stock">Browse stock</Link></Button>
        </div>
      </section>
    </div>
  );
}
