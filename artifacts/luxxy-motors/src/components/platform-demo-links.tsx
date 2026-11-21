import { useEffect, useRef, useState, type FormEvent } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import type { WebsiteTemplateDefinition, WebsiteTemplateId } from '@workspace/vehicle-meta';
import { Copy, ExternalLink, Link2 } from '@/components/icons';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';

const durations = [1, 7, 14] as const;
type Duration = typeof durations[number];
type ShareResult = { url: string; expiresAt: string };

const linkExpiry = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London',
});

export function PlatformDemoLinks({ dealerId, templates, disabled }: {
  dealerId: string;
  templates: readonly WebsiteTemplateDefinition[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WebsiteTemplateId[]>([]);
  const [days, setDays] = useState<Duration>(7);
  const [share, setShare] = useState<ShareResult>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const request = useRef<AbortController | null>(null);
  const shareInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (share) shareInput.current?.focus(); }, [share]);

  function toggleDesign(id: WebsiteTemplateId) {
    setSelected(previous => {
      if (previous.includes(id)) return previous.filter(value => value !== id);
      return previous.length < 3 ? [...previous, id] : previous;
    });
  }

  function changeOpen(nextOpen: boolean) {
    if (!nextOpen) {
      request.current?.abort();
      request.current = null;
      setSubmitting(false);
    }
    setOpen(nextOpen);
  }

  async function createLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected.length || request.current || share) return;
    const controller = new AbortController();
    request.current = controller;
    setSubmitting(true);
    setError('');
    try {
      const result = await customFetch<{ path: string; expiresAt: string }>(
        `/api/platform/dealers/${encodeURIComponent(dealerId)}/demo-links`, {
          method: 'POST', signal: controller.signal, responseType: 'json',
          body: JSON.stringify({ templates: selected, days }),
        },
      );
      if (controller.signal.aborted) return;
      if (typeof result?.path !== 'string' || !/^\/showcase\/[A-Za-z0-9_-]+$/.test(result.path)
        || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) {
        throw new Error('Invalid link response');
      }
      setCopyStatus('');
      setShare({ url: new URL(result.path, window.location.origin).href, expiresAt: result.expiresAt });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const status = cause instanceof HttpApiError ? cause.status : undefined;
      if (status === 401 || status === 403) setError('Sign in to Platform Admin again and retry.');
      else if (status === 404 || status === 410) setError('This demo is unavailable. Check its expiry before creating a link.');
      else setError('The link could not be created. Try again.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setSubmitting(false);
      }
    }
  }

  async function copyLink() {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopyStatus('Link copied.');
    } catch {
      shareInput.current?.focus();
      shareInput.current?.select();
      setCopyStatus('Select and copy the link above.');
    }
  }

  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild>
      <Button type="button" variant="outline" size="sm" disabled={disabled} className="shrink-0">
        <Link2 size={16} aria-hidden="true" /> Create demo links
      </Button>
    </DialogTrigger>
    <DialogContent className="sm:max-w-[34rem]">
      <DialogHeader>
        <DialogTitle>{share ? 'Link ready to share' : 'Create demo links'}</DialogTitle>
        <DialogDescription>{share
          ? 'Anyone with this link can browse the selected designs until it expires.'
          : 'Choose up to three designs. Each uses the same cars and opens without sign-in.'}</DialogDescription>
      </DialogHeader>
      {share ? <>
        <div className="grid gap-2">
          <label className="grid gap-2 text-sm font-semibold">
            Share link
            <Input ref={shareInput} value={share.url} readOnly spellCheck={false} />
          </label>
          <p className="text-sm text-muted-foreground">Expires <time dateTime={share.expiresAt}>{linkExpiry.format(new Date(share.expiresAt))}</time> (UK time)</p>
          {copyStatus && <p role="status" className="text-sm">{copyStatus}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShare(undefined)}>Create another link</Button>
          <Button asChild variant="outline" size="sm"><a href={share.url} target="_blank" rel="noopener noreferrer">Open link <ExternalLink size={16} aria-hidden="true" /></a></Button>
          <Button type="button" size="sm" onClick={() => void copyLink()}><Copy size={16} aria-hidden="true" /> Copy link</Button>
        </DialogFooter>
      </> : <form onSubmit={event => void createLink(event)} className="grid min-w-0 gap-4" aria-busy={submitting || undefined}>
        <fieldset disabled={submitting} className="min-w-0">
          <legend className="mb-1 text-sm font-semibold">Website designs</legend>
          <output className="text-sm text-muted-foreground">{selected.length} of 3 selected</output>
          <div className="mt-2 divide-y divide-border border-y border-border">
            {templates.map(template => {
              const checked = selected.includes(template.id);
              return <label key={template.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-2 py-2 text-sm font-medium hover:bg-muted/50 has-disabled:cursor-default has-disabled:text-muted-foreground">
                <input type="checkbox" className="size-4 shrink-0 accent-primary" value={template.id} checked={checked}
                  disabled={!checked && selected.length >= 3} onChange={() => toggleDesign(template.id)} />
                {template.name}
              </label>;
            })}
          </div>
        </fieldset>
        <label className="grid gap-2 text-sm font-semibold">
          Link expires after
          <NativeSelect disabled={submitting} value={days} onChange={event => setDays(Number(event.target.value) as Duration)}>
            {durations.map(duration => <option key={duration} value={duration}>{duration} {duration === 1 ? 'day' : 'days'}</option>)}
          </NativeSelect>
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => changeOpen(false)}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!selected.length || submitting}>{submitting ? 'Creating link…' : 'Create share link'}</Button>
        </DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
