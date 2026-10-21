import { useEffect, useId, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Image as ImageIcon, RefreshCw, Trash2 } from './icons';
import { requestUuid } from '@/lib/request-uuid';
import { prepareWebsiteImage, type WebsiteImageKind } from '@/lib/website-image';

type UploadRequest = { requestId: string; image: string };
type UploadedImage = { id: string; url: string; mimeType: string; width: number; height: number; byteSize: number; replayed: boolean };

export function WebsiteImageField({ label, hint, value, onChange, error, kind = 'logo', testId, disabled = false, onBusyChange }: {
  label: string; hint?: string; value: string; onChange: (url: string) => void;
  error?: string; kind?: WebsiteImageKind; testId?: string; disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true), active = useRef(false);
  const callbacks = useRef({ onChange, onBusyChange });
  callbacks.current = { onChange, onBusyChange };
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState(''), [notice, setNotice] = useState('');
  const [retry, setRetry] = useState<UploadRequest | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      if (active.current) { active.current = false; callbacks.current.onBusyChange?.(false); }
    };
  }, []);

  function start() {
    if (active.current || disabled) return false;
    active.current = true; setBusy(true); setFailure(''); setNotice('');
    callbacks.current.onBusyChange?.(true);
    controller.current = new AbortController();
    return true;
  }
  function finish() {
    if (active.current) { active.current = false; callbacks.current.onBusyChange?.(false); }
    if (mounted.current) setBusy(false);
  }
  async function send(body: UploadRequest) {
    const result = await customFetch<UploadedImage>('/api/staff/website-assets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.current?.signal,
    });
    if (!mounted.current || controller.current?.signal.aborted) return;
    const url = new URL(result.url, window.location.origin);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !/^\/api\/website-assets\/[a-f0-9-]+$/.test(url.pathname)) {
      throw new Error('The server returned an invalid image address. Try again.');
    }
    callbacks.current.onChange(result.url);
    setRetry(null); setNotice('Image added to your draft. Review and publish when ready.');
  }
  async function choose(file?: File) {
    if (!file || !start()) return;
    setRetry(null);
    try {
      const body = { requestId: requestUuid(), image: await prepareWebsiteImage(file, kind) };
      if (!mounted.current || controller.current?.signal.aborted) return;
      setRetry(body); await send(body);
    } catch (cause) {
      if (mounted.current && !controller.current?.signal.aborted) setFailure(cause instanceof Error ? cause.message : 'This image could not be uploaded. Try again.');
    } finally { finish(); }
  }
  async function retryUpload() {
    if (!retry || !start()) return;
    try { await send(retry); }
    catch (cause) { if (mounted.current && !controller.current?.signal.aborted) setFailure(cause instanceof Error ? cause.message : 'The upload could not be completed.'); }
    finally { finish(); }
  }
  return <div className="settings-image-field" aria-busy={busy}>
    <label htmlFor={id} className="settings-field-label"><span>{label}</span>{hint && <span className="settings-field-hint">{hint}</span>}</label>
    <div className="settings-image-actions">
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label={`Choose ${label.toLowerCase()} file`} disabled={busy || disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void choose(file); }} />
      <Button type="button" variant="outline" aria-label={`${value ? 'Replace' : 'Upload'} ${label.toLowerCase()}`} disabled={busy || disabled} onClick={() => input.current?.click()}><ImageIcon size={16} aria-hidden />{busy ? 'Preparing image…' : value ? 'Replace image' : 'Upload image'}</Button>
      {value && <Button type="button" variant="ghost" disabled={busy || disabled} onClick={() => { onChange(''); setRetry(null); setNotice('Image removed from your draft.'); setFailure(''); }}><Trash2 size={16} aria-hidden />Remove</Button>}
    </div>
    <details className="settings-image-address"><summary>Use an image link</summary><Input id={id} type="url" maxLength={2048} disabled={busy || disabled} value={value} onChange={event => { onChange(event.target.value); setRetry(null); setFailure(''); setNotice(''); }} placeholder="https://…" data-testid={testId} aria-label={`${label} image URL`} /></details>
    {(failure || error) && <p className="settings-field-error" role="alert">{failure || error}</p>}
    {failure && retry && <Button type="button" variant="outline" disabled={busy || disabled} onClick={() => void retryUpload()}><RefreshCw size={16} aria-hidden />Retry upload</Button>}
    {notice && <p className="settings-image-notice" role="status">{notice}</p>}
  </div>;
}
