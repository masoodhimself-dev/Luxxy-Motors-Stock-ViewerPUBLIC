import { useId, useRef, useState, type FormEvent } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { Check, ExternalLink, StockImport } from '@/components/icons';
import { Button } from './ui/button';
import { Input } from './ui/input';

const maxFileSize = 5 * 1024 * 1024;
const number = new Intl.NumberFormat('en-GB');

type ImportResult = {
  status: 'imported' | 'replayed';
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  runId: string;
};
type UploadError = { message: string; details?: string[] };

function stockUploadError(cause: unknown): UploadError {
  if (cause instanceof HttpApiError) {
    if (cause.status === 413) return { message: 'Choose a stock JSON file no larger than 5 MB.' };
    if (cause.data && typeof cause.data === 'object') {
      const failure = cause.data as { status?: string; error?: unknown; errors?: { code?: string; message?: string }[] };
      const issues = Array.isArray(failure.errors) ? failure.errors : [];
      if (issues.some(issue => issue.code === 'invalid_json')) return { message: 'This file is not valid JSON. Export a fresh stock snapshot and try again.' };
      return {
        message: typeof failure.error === 'string' ? failure.error : failure.status === 'quarantined'
          ? 'The stock checks held this import. Review the details below before trying again.'
          : 'The stock file could not be imported.',
        details: issues.flatMap(issue => typeof issue.message === 'string' ? [issue.message] : []),
      };
    }
  }
  return { message: 'The upload could not be confirmed. Check Imports or retry with the same file.' };
}

export function PlatformStockUpload({ dealerId, disabled, onImported, onOpenImports }: {
  dealerId: string;
  disabled?: boolean;
  onImported: () => void;
  onOpenImports: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UploadError>();
  const [result, setResult] = useState<ImportResult>();
  const dealerPath = encodeURIComponent(dealerId);

  function choose(selected?: File) {
    setError(undefined);
    setFile(undefined);
    if (!selected) return;
    if (!/\.json$/i.test(selected.name) || selected.size === 0 || selected.size > maxFileSize) {
      if (input.current) input.current.value = '';
      setError({ message: 'Choose a non-empty JSON file no larger than 5 MB.' });
      return;
    }
    setFile(selected);
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || busy || disabled) return;
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await customFetch<ImportResult>(`/api/platform/dealers/${dealerPath}/stock-upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: file,
      });
      if (response?.status !== 'imported' && response?.status !== 'replayed') throw new Error('Unexpected stock upload response.');
      setResult(response);
      setFile(undefined);
      if (input.current) input.current.value = '';
      onImported();
    } catch (cause) { setError(stockUploadError(cause)); }
    finally { setBusy(false); }
  }

  return <section className="platform-stock-upload" aria-labelledby={`${id}-title`}>
    <div className="platform-stock-upload-heading">
      <span className="platform-stock-upload-icon"><StockImport size={19} aria-hidden="true"/></span>
      <div>
        <h3 id={`${id}-title`}>Upload stock JSON</h3>
        <p id={`${id}-hint`}>Choose the latest complete Grok or Auto Trader stock export for this dealership. Up to 5 MB.</p>
      </div>
    </div>
    <form className="platform-stock-upload-form" onSubmit={event => void upload(event)} aria-busy={busy}>
      <label className="platform-field"><span>Stock JSON file</span><Input ref={input} type="file" accept=".json,application/json" aria-describedby={`${id}-hint`} disabled={busy || disabled} onChange={event => choose(event.currentTarget.files?.[0])}/></label>
      <Button type="submit" disabled={!file || busy || disabled}>{busy ? 'Importing stock…' : 'Import stock'}</Button>
    </form>
    {error && <div className="platform-stock-upload-error" role="alert">
      <p>{error.message}</p>
      {error.details && error.details.length > 0 && <ul>{error.details.slice(0, 4).map((message, index) => <li key={index}>{message}</li>)}</ul>}
      {error.details && error.details.length > 4 && <p>{number.format(error.details.length - 4)} more details in Imports, if the import was recorded.</p>}
    </div>}
    {result && <div className="platform-stock-upload-result" role="status">
      <strong><Check size={16} aria-hidden="true"/>{result.status === 'replayed' ? 'This file was already imported' : 'Stock imported'}</strong>
      <dl>{([
        ['Received', result.received], ['Added', result.created], ['Updated', result.updated], ['Unchanged', result.unchanged],
      ] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{number.format(count)}</dd></div>)}</dl>
    </div>}
    <div className="platform-stock-upload-actions">
      <Button asChild variant="outline"><a href={`/platform/preview/${dealerPath}/stock`} target="_blank" rel="noopener noreferrer">Open private stock preview <ExternalLink size={15} aria-hidden="true"/><span className="sr-only"> in a new tab</span></a></Button>
      {result && <Button type="button" variant="ghost" onClick={onOpenImports}>View imports</Button>}
    </div>
  </section>;
}
