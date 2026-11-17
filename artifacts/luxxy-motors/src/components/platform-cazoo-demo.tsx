import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { CheckCircle2, Copy, ExternalLink } from '@/components/icons';
import { Button, buttonVariants } from './ui/button';
import { Textarea } from './ui/textarea';
import './platform-cazoo-demo.css';

type CazooDemoResult = {
  dealerId: string;
  dealerName: string;
  previewPath: string;
  received: number;
  hasLogo: boolean;
};

type CazooDemoProps = {
  dealer: { sourceUrl: string; retailerId: string };
  prompt: string;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onManage: (dealerId: string) => void;
};

const uploadLimit = 5 * 1024 * 1024;
const stockFileLimit = 8 * 1024 * 1024;
const logoDataLimit = Math.ceil(250_000 / 3) * 4 + 'data:image/jpeg;base64,'.length;
const logoTypes = ['image/png', 'image/jpeg', 'image/webp'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStockJson(input: string, retailerId: string) {
  const trimmed = input.trim();
  const fenced = /^```(?:json)?[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  let data: unknown;
  try {
    data = JSON.parse(fenced?.[1] ?? trimmed);
  } catch {
    throw new Error('Paste the full JSON response from Grok Bot, or choose the downloaded JSON file.');
  }
  const stock = record(data) && 'stock' in data ? data.stock : data;
  if (!record(stock) || stock.schemaVersion !== 1 || stock.source !== 'grok' || !Array.isArray(stock.cars)) {
    throw new Error('This JSON doesn’t contain a version 1 stock list. Use the prompt above to get the right format.');
  }
  if (stock.retailerId !== retailerId && stock.retailerId !== retailerId.slice('cazoo-'.length)) {
    throw new Error('This stock JSON is for a different Cazoo dealership. Use the prompt above to export the right stock.');
  }

  const logoData = record(data) && data !== stock ? data.logoData : undefined;
  if (logoData != null && typeof logoData !== 'string') {
    throw new Error('The logo in the JSON should be an image data URL. You can also choose the dealership’s logo below.');
  }
  return { stock, logoData: logoData || undefined };
}

async function prepareLogo(file: File) {
  if (!logoTypes.includes(file.type) || file.size > 5_000_000) {
    throw new Error('Choose a PNG, JPEG or WebP smaller than 5 MB.');
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('This image couldn’t be opened. Choose another copy of the logo.');
  });
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 600 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser couldn’t prepare this logo.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/png');
    if (data.length > logoDataLimit) throw new Error('This logo is too detailed. Choose a simpler image smaller than 250 KB.');
    return data;
  } finally {
    bitmap.close();
  }
}

function checkedResult(demo: CazooDemoResult) {
  if (!demo || typeof demo.dealerId !== 'string' || !demo.dealerId
    || typeof demo.dealerName !== 'string' || !demo.dealerName.trim()
    || !Number.isInteger(demo.received) || demo.received < 1
    || typeof demo.hasLogo !== 'boolean') {
    throw new Error('Private demo response was incomplete.');
  }
  const preview = `/platform/preview/${encodeURIComponent(demo.dealerId)}`;
  if (demo.previewPath !== preview && demo.previewPath !== `${preview}/stock`) {
    throw new Error('Private demo response was incomplete.');
  }
  return demo;
}

export function PlatformCazooDemo({ dealer, prompt, busy, onBusyChange, onManage }: CazooDemoProps) {
  const id = useId();
  const [json, setJson] = useState('');
  const [stockFile, setStockFile] = useState('');
  const [logo, setLogo] = useState<{ data: string; name: string }>();
  const [copyMessage, setCopyMessage] = useState('');
  const [error, setError] = useState<{ field: 'submit' | 'stock' | 'logo'; message: string }>();
  const [working, setWorking] = useState<'stock' | 'logo' | 'create'>();
  const [result, setResult] = useState<CazooDemoResult>();
  const promptDetails = useRef<HTMLDetailsElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const stockInput = useRef<HTMLTextAreaElement>(null);
  const previewLink = useRef<HTMLAnchorElement>(null);
  const pending = useRef(false);
  const disabled = busy || Boolean(working);

  useEffect(() => {
    if (result) previewLink.current?.focus();
  }, [result]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyMessage('Prompt copied.');
    } catch {
      if (promptDetails.current) promptDetails.current.open = true;
      promptInput.current?.focus();
      promptInput.current?.select();
      setCopyMessage('Copy the selected prompt.');
    }
  }

  async function chooseFile(kind: 'stock' | 'logo', file: File | undefined) {
    if (!file || disabled || pending.current) return;
    pending.current = true;
    setError(undefined);
    setWorking(kind);
    onBusyChange(true);
    try {
      if (kind === 'stock') {
        if (file.size > stockFileLimit) throw new Error('Choose a JSON file under 8 MB. The stock itself can be up to 5 MB.');
        const content = await file.text();
        parseStockJson(content, dealer.retailerId);
        setJson(content);
        setStockFile(file.name);
      } else {
        setLogo({ data: await prepareLogo(file), name: file.name });
      }
    } catch (cause) {
      setError({ field: kind, message: cause instanceof Error ? cause.message : 'Could not open this file. Choose another copy.' });
    } finally {
      pending.current = false;
      setWorking(undefined);
      onBusyChange(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || pending.current || !json.trim()) return;

    let body: string;
    try {
      const payload = parseStockJson(json, dealer.retailerId);
      const stock = JSON.stringify(payload.stock);
      if (new Blob([stock]).size > uploadLimit) throw new Error('The stock JSON is larger than 5 MB.');
      const logoData = logo?.data ?? payload.logoData;
      if (logoData && logoData.length > logoDataLimit) {
        throw new Error('The logo in the JSON is too large. Choose a smaller image below.');
      }
      body = JSON.stringify({
        sourceUrl: dealer.sourceUrl,
        stock: payload.stock,
        logoData,
      });
    } catch (cause) {
      setError({ field: 'stock', message: cause instanceof Error ? cause.message : 'Check the stock JSON and try again.' });
      stockInput.current?.focus();
      return;
    }

    pending.current = true;
    setError(undefined);
    setWorking('create');
    onBusyChange(true);
    try {
      const demo = await customFetch<CazooDemoResult>('/api/platform/demos/from-cazoo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      setResult(checkedResult(demo));
    } catch (cause) {
      const detail = cause instanceof HttpApiError ? (cause.data as { error?: unknown } | null)?.error : null;
      setError({
        field: 'submit',
        message: typeof detail === 'string' && detail
          ? detail
          : 'Could not confirm the private demo. Check your connection and try again.',
      });
    } finally {
      pending.current = false;
      setWorking(undefined);
      onBusyChange(false);
    }
  }

  if (result) return <div className="platform-cazoo-demo platform-cazoo-demo--ready">
    <div role="status" className="platform-demo-link-intro">
      <span className="platform-demo-link-icon"><CheckCircle2 size={18} aria-hidden="true"/></span>
      <div>
        <h3>{result.dealerName} is ready to show</h3>
        <p>{result.received.toLocaleString('en-GB')} {result.received === 1 ? 'vehicle' : 'vehicles'} imported into the private demo.</p>
        <p>{result.hasLogo ? 'The dealership logo is included.' : 'The preview uses the dealership name as its logo.'}</p>
      </div>
    </div>
    <div className="platform-demo-link-actions">
      <a className={buttonVariants()} ref={previewLink} href={result.previewPath} target="_blank" rel="noopener noreferrer">
        Open private preview <ExternalLink size={16} aria-hidden="true"/><span className="sr-only"> in a new tab</span>
      </a>
      <Button type="button" variant="outline" disabled={busy} onClick={() => onManage(result.dealerId)}>Manage demo</Button>
    </div>
  </div>;

  return <div className="platform-cazoo-demo">
    <div className="platform-cazoo-prompt">
      <div className="platform-cazoo-prompt-heading">
        <div>
          <h4>Grok Bot prompt</h4>
          <p>Send this prompt to Grok Bot to collect the dealership’s stock and photos.</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void copyPrompt()}>
          <Copy size={16} aria-hidden="true"/> Copy prompt
        </Button>
      </div>
      <details ref={promptDetails}>
        <summary>View prompt</summary>
        <Textarea ref={promptInput} rows={5} readOnly value={prompt} aria-label="Grok Bot prompt" className="platform-cazoo-code"/>
      </details>
      <p className="platform-cazoo-feedback" role="status">{copyMessage}</p>
    </div>

    <form className="platform-cazoo-form" onSubmit={event => void create(event)} aria-busy={Boolean(working)}>
      <label className="platform-field">
        <span>Stock JSON from Grok Bot</span>
        <Textarea ref={stockInput} rows={4} value={json} disabled={disabled} spellCheck={false}
          placeholder="Paste the full JSON response"
          aria-describedby={error?.field === 'stock' ? `${id}-error` : undefined}
          aria-invalid={error?.field === 'stock' || undefined}
          onChange={event => {
            setJson(event.target.value);
            setStockFile('');
            setError(undefined);
          }}/>
      </label>
      <div className="platform-cazoo-files">
        <div>
          <input id={`${id}-json`} className="sr-only" type="file" accept=".json,application/json" disabled={disabled}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void chooseFile('stock', file);
            }}/>
          <label className={buttonVariants({ variant: 'outline', size: 'sm' })} htmlFor={`${id}-json`}>Choose JSON file</label>
          {stockFile && <p>{stockFile}</p>}
        </div>
        <div>
          <input id={`${id}-logo`} className="sr-only" type="file" accept={logoTypes.join(',')} disabled={disabled}
            aria-describedby={error?.field === 'logo' ? `${id}-error` : undefined}
            aria-invalid={error?.field === 'logo' || undefined}
            onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              void chooseFile('logo', file);
            }}/>
          <label className={buttonVariants({ variant: 'outline', size: 'sm' })} htmlFor={`${id}-logo`}>
            {logo ? 'Change logo' : 'Add logo (optional)'}
          </label>
          {logo && <div className="platform-cazoo-logo">
            <img src={logo.data} alt="Selected dealership logo"/>
            <span>{logo.name}</span>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => {
              setLogo(undefined);
              setError(undefined);
            }}>Remove logo</Button>
          </div>}
        </div>
      </div>
      {working && <p className="platform-demo-link-progress" role="status">{
        working === 'create' ? 'Importing the Cazoo stock and preparing the private demo…' : 'Reading the selected file…'
      }</p>}
      {error && <p className="platform-demo-link-error" id={`${id}-error`} role="alert">{error.message}</p>}
      <Button type="submit" className="platform-cazoo-create" disabled={disabled || !json.trim()}>
        {working === 'create' ? 'Creating private demo…' : 'Create private demo'}
      </Button>
    </form>
  </div>;
}
