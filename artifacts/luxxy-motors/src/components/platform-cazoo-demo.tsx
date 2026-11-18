import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { CheckCircle2, Copy, ArrowRight } from '@/components/icons';
import { Button, buttonVariants } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import './platform-cazoo-demo.css';
import { platformDemoReviewHref } from '@/lib/platform-demo-review';

type CazooDemoResult = {
  dealerId: string;
  dealerName: string;
  previewPath: string;
  received: number;
  hasLogo: boolean;
};

type StockJsonDemoProps = {
  platform: 'autotrader' | 'cazoo';
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

type PublicTextField = 'phone' | 'email' | 'websiteUrl' | 'about' | 'visitInstructions' | 'warrantyDescription' | 'deliveryDescription' | 'partExchangeDescription';
type SourceEvidence = { sourceUrl: string; checkedAt: string };
type OpeningDay = { day: number; status: 'open' | 'closed' | 'appointment_only' | 'unknown'; open?: string; close?: string };
export type DealerPublicDetails = SourceEvidence & Partial<Record<PublicTextField, string>> & {
  showroomAddress?: SourceEvidence & { street: string; city: string; region?: string; postcode: string; mapsUrl?: string };
  openingHours?: SourceEvidence & { timezone: 'Europe/London'; days: OpeningDay[] };
  includedItems?: string[];
};
const publicTextFields: PublicTextField[] = ['phone', 'email', 'websiteUrl', 'about', 'visitInstructions', 'warrantyDescription', 'deliveryDescription', 'partExchangeDescription'];
const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseStockJson(input: string, retailerId: string, platform: StockJsonDemoProps['platform']) {
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
  const retailerMatches = stock.retailerId === retailerId || (platform === 'cazoo' && stock.retailerId === retailerId.replace(/^cazoo-/, ''));
  if (!retailerMatches) {
    throw new Error(`This stock JSON is for a different ${platform === 'cazoo' ? 'Cazoo' : 'Auto Trader'} dealership. Use the prompt above to export the right stock.`);
  }

  const logoData = record(data) && data !== stock ? data.logoData : undefined;
  if (logoData != null && typeof logoData !== 'string') {
    throw new Error('The logo in the JSON should be an image data URL. You can also choose the dealership’s logo below.');
  }
  const details = record(data) && data !== stock ? data.dealershipDetails : undefined;
  if (details != null) {
    const invalid = () => new Error('The dealership details are incomplete. Use the prompt above to export them in the correct format.');
    if (!record(details) || typeof details.sourceUrl !== 'string' || typeof details.checkedAt !== 'string'
      || publicTextFields.some(key => details[key] != null && typeof details[key] !== 'string')
      || (details.includedItems != null && (!Array.isArray(details.includedItems) || details.includedItems.some(item => typeof item !== 'string')))) throw invalid();
    if (details.showroomAddress != null) {
      const address = details.showroomAddress;
      if (!record(address) || ['street', 'city', 'postcode', 'sourceUrl', 'checkedAt'].some(key => typeof address[key] !== 'string')
        || ['region', 'mapsUrl'].some(key => address[key] != null && typeof address[key] !== 'string')) throw invalid();
    }
    if (details.openingHours != null) {
      const hours = details.openingHours;
      if (!record(hours) || hours.timezone !== 'Europe/London' || typeof hours.sourceUrl !== 'string' || typeof hours.checkedAt !== 'string'
        || !Array.isArray(hours.days) || hours.days.length !== 7 || hours.days.some(day => !record(day) || !Number.isInteger(day.day)
          || Number(day.day) < 0 || Number(day.day) > 6
          || !['open', 'closed', 'appointment_only', 'unknown'].includes(String(day.status))
          || (day.status === 'open' && (typeof day.open !== 'string' || typeof day.close !== 'string')))) throw invalid();
      if (new Set(hours.days.map(day => day.day)).size !== 7) throw invalid();
    }
  }
  return { stock, logoData: logoData || undefined, dealershipDetails: details == null ? undefined : details as DealerPublicDetails };
}

export function PublicDetailsReview({ value, sourceUrl, disabled, onChange, expanded = false, allowRemoval = true }: {
  value: DealerPublicDetails | undefined;
  expanded?: boolean;
  allowRemoval?: boolean;
  sourceUrl: string;
  disabled: boolean;
  onChange: (value: DealerPublicDetails) => void;
}) {
  const evidence = { sourceUrl, checkedAt: new Date().toISOString() };
  const current: DealerPublicDetails = value ?? evidence;
  const update = (patch: Partial<DealerPublicDetails>) => onChange({ ...current, ...patch });
  function updateText(key: PublicTextField, text: string) {
    update({ [key]: text });
  }
  const present = [value?.phone, value?.email, value?.showroomAddress, value?.openingHours].filter(Boolean).length;
  return <details className="platform-cazoo-public-details" open={expanded || undefined} onInvalidCapture={event => {
    if (!(event.target instanceof HTMLElement)) return;
    for (let parent = event.target.parentElement; parent; parent = parent.parentElement) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      if (parent === event.currentTarget) break;
    }
  }}>
    <summary>Public dealership details <span>{present ? `${present} contact details supplied` : 'Add contact details'}</span></summary>
    <div className="platform-cazoo-details-fields">
      <p>{value ? 'Check these details before opening the demo.' : 'This export has no dealership details. Add the public information you want shown in the demo.'}</p>
      <div className="platform-cazoo-contact-fields">
        {([
          ['phone', 'Showroom phone', 'tel', 40],
          ['email', 'Public email', 'email', 160],
          ['websiteUrl', 'Dealership website', 'url', 2048],
        ] as const).map(([field, label, type, maxLength]) => <label key={field} className="platform-field">
          <span>{label}</span><Input type={type} value={current[field] ?? ''} maxLength={maxLength} disabled={disabled}
            onChange={event => updateText(field, event.target.value)}/>
        </label>)}
      </div>
      {(['about', 'visitInstructions'] as const).map(field => <label className="platform-field" key={field}>
        <span>{field === 'about' ? 'About the dealership' : 'Visiting instructions'}</span>
        <Textarea rows={2} maxLength={1000} disabled={disabled} value={current[field] ?? ''}
          onChange={event => updateText(field, event.target.value)}/>
      </label>)}
      <details className="platform-cazoo-details-section">
        <summary>Showroom address{current.showroomAddress ? '' : ' · not supplied'}</summary>
        {current.showroomAddress ? <div className="platform-cazoo-address-fields">
          {(['street', 'city', 'region', 'postcode', 'mapsUrl'] as const).map(field => <label className="platform-field" key={field}>
            <span>{{ street: 'Street address', city: 'Town or city', region: 'Region', postcode: 'Postcode', mapsUrl: 'Map link' }[field]}</span>
            <Input value={current.showroomAddress?.[field] ?? ''} disabled={disabled} type={field === 'mapsUrl' ? 'url' : 'text'}
              maxLength={field === 'mapsUrl' ? 2048 : field === 'street' ? 160 : field === 'postcode' ? 20 : 80}
              required={field === 'street' || field === 'city' || field === 'postcode'}
              onChange={event => update({ showroomAddress: { ...current.showroomAddress!, [field]: event.target.value } })}/>
          </label>)}
          {allowRemoval && <Button type="button" variant="ghost" size="sm" disabled={disabled}
            onClick={() => update({ showroomAddress: undefined })}>Remove showroom address</Button>}
        </div> : <Button type="button" variant="outline" size="sm" disabled={disabled}
          onClick={() => update({ showroomAddress: { ...evidence, street: '', city: '', postcode: '' } })}>Add showroom address</Button>}
      </details>
      <details className="platform-cazoo-details-section">
        <summary>Opening hours{current.openingHours ? '' : ' · not supplied'}</summary>
        {current.openingHours ? <div className="platform-cazoo-hours-fields">
          {[...current.openingHours.days].sort((a, b) => (a.day + 6) % 7 - (b.day + 6) % 7).map(day => <div className="platform-cazoo-opening-day" key={day.day}>
            <label className="platform-field"><span>{weekdayNames[day.day]}</span>
              <NativeSelect aria-label={`${weekdayNames[day.day]} opening status`} value={day.status} disabled={disabled}
                onChange={event => {
                  const status = event.target.value as OpeningDay['status'];
                  const next: OpeningDay = status === 'open' ? { day: day.day, status, open: '', close: '' } : { day: day.day, status };
                  update({ openingHours: { ...current.openingHours!, days: current.openingHours!.days.map(row => row.day === day.day ? next : row) } });
                }}>
                <option value="unknown">Not confirmed</option><option value="open">Open</option><option value="closed">Closed</option><option value="appointment_only">By appointment</option>
              </NativeSelect>
            </label>
            {day.status === 'open' && (['open', 'close'] as const).map(field => <label key={field} className="platform-field">
              <span>{field === 'open' ? 'Opens' : 'Closes'}</span><Input type="time" required value={day[field] ?? ''} disabled={disabled}
                aria-label={`${weekdayNames[day.day]} ${field === 'open' ? 'opening' : 'closing'} time`}
                onChange={event => update({ openingHours: { ...current.openingHours!, days: current.openingHours!.days.map(row => row.day === day.day ? { ...row, [field]: event.target.value } : row) } })}/>
            </label>)}
          </div>)}
          {allowRemoval && <Button type="button" variant="ghost" size="sm" disabled={disabled}
            onClick={() => update({ openingHours: undefined })}>Remove opening hours</Button>}
        </div> : <Button type="button" variant="outline" size="sm" disabled={disabled}
          onClick={() => update({ openingHours: { ...evidence, timezone: 'Europe/London', days: weekdayNames.map((_, day) => ({ day, status: 'unknown' })) } })}>Add opening hours</Button>}
      </details>
      <details className="platform-cazoo-details-section">
        <summary>What the dealership offers</summary>
        <p>Use only the dealership’s confirmed public wording.</p>
        <label className="platform-field"><span>What’s included with every car</span>
          <Textarea rows={3} disabled={disabled} value={current.includedItems?.join('\n') ?? ''} placeholder="One item per line"
            onChange={event => update({ includedItems: event.target.value.split('\n') })}/>
        </label>
        {(['warrantyDescription', 'deliveryDescription', 'partExchangeDescription'] as const).map(field => <label className="platform-field" key={field}>
          <span>{{ warrantyDescription: 'Warranty', deliveryDescription: 'Delivery', partExchangeDescription: 'Part exchange' }[field]}</span>
          <Textarea rows={2} maxLength={300} disabled={disabled} value={current[field] ?? ''} onChange={event => updateText(field, event.target.value)}/>
        </label>)}
      </details>
    </div>
  </details>;
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

/** Shared stock upload and public-details review for both marketplaces. */
export function PlatformStockJsonDemo({ platform, dealer, prompt, busy, onBusyChange, onManage }: StockJsonDemoProps) {
  const id = useId();
  const [json, setJson] = useState('');
  const [stockFile, setStockFile] = useState('');
  const [publicDetails, setPublicDetails] = useState<DealerPublicDetails>();
  const [stockParsed, setStockParsed] = useState(false);
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
        const payload = parseStockJson(content, dealer.retailerId, platform);
        setJson(content);
        setStockFile(file.name);
        setPublicDetails(payload.dealershipDetails);
        setStockParsed(true);
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
      const payload = parseStockJson(json, dealer.retailerId, platform);
      const stock = JSON.stringify(payload.stock);
      if (new Blob([stock]).size > uploadLimit) throw new Error('The stock JSON is larger than 5 MB.');
      const logoData = logo?.data ?? payload.logoData;
      if (logoData && logoData.length > logoDataLimit) {
        throw new Error('The logo in the JSON is too large. Choose a smaller image below.');
      }
      const details = publicDetails ?? payload.dealershipDetails;
      body = JSON.stringify({
        sourceUrl: dealer.sourceUrl,
        stock: payload.stock,
        logoData,
        dealershipDetails: details && {
          ...details,
          includedItems: details.includedItems?.map(text => text.trim()).filter(Boolean),
          showroomAddress: details.showroomAddress && { ...details.showroomAddress, mapsUrl: details.showroomAddress.mapsUrl?.trim() || undefined },
        },
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
      const demo = await customFetch<CazooDemoResult>(`/api/platform/demos/from-${platform}`, {
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
        <h3>{result.dealerName} stock imported</h3>
        <p>{result.received.toLocaleString('en-GB')} {result.received === 1 ? 'vehicle' : 'vehicles'} imported into the private demo.</p>
        <p>{result.hasLogo ? 'The dealership logo is included.' : 'The preview uses the dealership name as its logo.'}</p>
      </div>
    </div>
    <div className="platform-demo-link-actions">
      <a className={buttonVariants()} ref={previewLink} href={platformDemoReviewHref(result.dealerId)}>
        Review demo <ArrowRight size={16} aria-hidden="true"/>
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
            setPublicDetails(undefined);
            setStockParsed(false);
            try {
              const payload = parseStockJson(event.target.value, dealer.retailerId, platform);
              setPublicDetails(payload.dealershipDetails);
              setStockParsed(true);
            } catch {
              // Keep the draft editable while JSON is incomplete.
            }
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
      {stockParsed && <PublicDetailsReview value={publicDetails} sourceUrl={dealer.sourceUrl} disabled={disabled} onChange={setPublicDetails}/>}
      {working && <p className="platform-demo-link-progress" role="status">{
        working === 'create' ? `Importing the ${platform === 'cazoo' ? 'Cazoo' : 'Auto Trader'} stock and preparing the private demo…` : 'Reading the selected file…'
      }</p>}
      {error && <p className="platform-demo-link-error" id={`${id}-error`} role="alert">{error.message}</p>}
      <Button type="submit" className="platform-cazoo-create" disabled={disabled || !json.trim()}>
        {working === 'create' ? 'Creating private demo…' : 'Create private demo'}
      </Button>
    </form>
  </div>;
}

/** Existing Cazoo callers keep the same props and behavior. */
export function PlatformCazooDemo(props: Omit<StockJsonDemoProps, 'platform'>) {
  return <PlatformStockJsonDemo {...props} platform="cazoo"/>;
}
