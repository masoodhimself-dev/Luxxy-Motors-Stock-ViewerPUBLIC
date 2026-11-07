import { useId, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { stockAlertCriteriaLabel } from '@workspace/vehicle-meta/stock-filters';
import { Mail } from '@/components/icons';
import { PrivacyNoticeLink } from '@/components/privacy-notice-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { StockFilters } from '@/features/stock-search/types';
import { normaliseStockFilters, serializeStockFilters } from '@/features/stock-search/url';

export function StockAlertOffer({ filters, privacyUrl }: { filters: StockFilters; privacyUrl?: string }) {
  const criteria = normaliseStockFilters({ ...filters, search: filters.search.trim(), sort: '', page: 1 });
  const search = serializeStockFilters(criteria).toString();
  const status = useQuery({
    queryKey: ['stock-alert-status'],
    queryFn: ({ signal }) => customFetch<{ enabled: boolean; preview?: boolean }>('/api/stock-alerts/status', { signal }),
    enabled: Boolean(search),
    retry: false,
    staleTime: 60_000,
  });

  if (!search || status.data?.enabled !== true) return null;
  return <StockAlertSignup key={search} filters={criteria} privacyUrl={privacyUrl} preview={status.data.preview === true} />;
}

function StockAlertSignup({ filters, privacyUrl, preview }: { filters: StockFilters; privacyUrl?: string; preview: boolean }) {
  const id = useId();
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  const [previewToken, setPreviewToken] = useState('');

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== 'idle') return;
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    const { sort: _sort, page: _page, ...criteria } = filters;
    setError('');
    setPhase('sending');
    try {
      const result = await customFetch<{ confirmToken?: string } | null>('/api/stock-alerts', {
        method: 'POST',
        body: JSON.stringify({ email, filters: criteria }),
      });
      if (preview && typeof result?.confirmToken === 'string') setPreviewToken(result.confirmToken);
      setPhase('sent');
    } catch (cause) {
      const status = (cause as { status?: number } | null)?.status;
      setError(status === 429
        ? 'Too many requests. Please try again in a few minutes.'
        : 'We couldn’t set up the alert. Please try again.');
      setPhase('idle');
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="my-5 border-y border-border py-5">
      <h4 id={`${id}-title`} className="flex items-center gap-2.5 text-base font-semibold text-foreground sm:text-lg">
        <Mail size={20} aria-hidden="true" className="shrink-0 text-primary" />
        Tell me when one comes in
      </h4>
      <p className="mt-2 break-words text-sm font-semibold leading-6 text-foreground">{stockAlertCriteriaLabel(filters)}</p>
      {preview && <p className="mt-2 text-sm leading-6 text-muted-foreground">Local preview. No emails are sent.</p>}
      {phase === 'sent' ? (
        <div className="mt-3 text-sm leading-6 text-foreground">
          <p role="status">{previewToken ? 'Your sample alert is ready to confirm.' : 'Check your inbox. Open the confirmation link to start your stock alert.'}</p>
          {previewToken && <a className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4" href={`/stock-alerts/confirm#token=${encodeURIComponent(previewToken)}`}>Open sample confirmation link</a>}
        </div>
      ) : (
        <>
          <p id={`${id}-details`} className="mt-1 max-w-lg text-sm leading-6 text-muted-foreground">
            We’ll email you when a car matches this search, up to once a day. Your alert lasts 60 days.
          </p>
          <form onSubmit={subscribe} aria-labelledby={`${id}-title`} className="mt-3 grid max-w-lg gap-2">
            <label htmlFor={`${id}-email`} className="text-sm font-semibold text-foreground">Email address</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id={`${id}-email`}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                aria-describedby={`${id}-details`}
                maxLength={254}
                required
                readOnly={phase === 'sending'}
                className="min-h-12 min-w-0 px-3 text-base"
              />
              <Button type="submit" disabled={phase === 'sending'} className="shrink-0">
                {phase === 'sending' ? 'Sending…' : 'Get stock alerts'}
              </Button>
            </div>
            {error && <p role="alert" className="text-sm leading-6 text-destructive">{error}</p>}
          </form>
          <PrivacyNoticeLink url={privacyUrl} className="mt-2 inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-4" />
        </>
      )}
    </section>
  );
}
