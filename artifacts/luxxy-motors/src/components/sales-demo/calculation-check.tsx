import { useCallback, useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { saleCalculationFigures, saleCalculationSnapshot, type SaleCalculationCheckResult, type SaleWorkspaceDraft, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { AlertCircle, CheckCircle2, LoaderCircle } from '@/components/icons';
import './calculation-check.css';

/** Call check only from Preview/confirm, never from an effect while the dealer types. */
export function useSaleCalculationCheck() {
  const [result, setResult] = useState<SaleCalculationCheckResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, { result: SaleCalculationCheckResult; until: number }>());
  const reset = useCallback(() => { generation.current++; controller.current?.abort(); setBusy(false); setResult(null); setError(''); }, []);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  const check = useCallback(async (sale: SaleWorkspaceRecord, draft: SaleWorkspaceDraft = sale.draft, options: { testOnly?: boolean } = {}) => {
    controller.current?.abort();
    const attempt = ++generation.current;
    setResult(null); setError('');
    let snapshot: ReturnType<typeof saleCalculationSnapshot>;
    try { snapshot = saleCalculationSnapshot(sale, saleCalculationFigures(draft)); }
    catch (problem) { setBusy(false); setError(problem instanceof Error ? problem.message : 'Check the amounts before previewing.'); return null; }
    const localKey = JSON.stringify([options.testOnly === true ? 'test' : 'live', sale.id, snapshot]);
    const previous = cache.current.get(localKey);
    if (previous && previous.until > Date.now()) { const value = { ...previous.result, cached: true }; setBusy(false); setResult(value); return value; }
    // A test preview never calls a live sale endpoint or spends AI allowance.
    if (options.testOnly) {
      const value: SaleCalculationCheckResult = { status: 'checked', message: 'The total and balance add up.', financialKey: localKey, totals: snapshot.totals, checkedAt: new Date().toISOString(), cached: false };
      setBusy(false); setResult(value); return value;
    }
    const request = new AbortController(); controller.current = request; setBusy(true);
    try {
      const value = await customFetch<SaleCalculationCheckResult>(`/api/sale-operations/${sale.id}/calculation-check`, { method: 'POST', signal: request.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: sale.revision, figures: saleCalculationFigures(draft) }) });
      if (attempt !== generation.current || request.signal.aborted) return null;
      if (value.status !== 'unavailable') {
        if (cache.current.size >= 30) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(localKey, { result: value, until: Date.now() + 3600000 });
      }
      setResult(value); return value;
    } catch {
      if (attempt !== generation.current || request.signal.aborted) return null;
      const value: SaleCalculationCheckResult = { status: 'unavailable', message: 'The amounts have been calculated. AI could not double-check them. You can continue.', financialKey: localKey, totals: snapshot.totals, checkedAt: new Date().toISOString(), cached: false };
      setResult(value); return value;
    } finally { if (attempt === generation.current) setBusy(false); }
  }, []);
  return { result, busy, error, check, reset };
}

/** Small inline feedback, with no approval button, checklist or override workflow. */
export function CalculationCheck({ result, busy = false, error = '' }: { result?: SaleCalculationCheckResult | null; busy?: boolean; error?: string }) {
  if (!busy && !result && !error) return null;
  const Icon = busy ? LoaderCircle : error || result?.status !== 'checked' ? AlertCircle : CheckCircle2;
  return <p className={`sale-calculation-check${busy ? ' is-checking' : ''}`} role="status" aria-live="polite"><Icon aria-hidden="true" /><span>{busy ? 'Double-checking the amounts…' : error || result?.message}</span></p>;
}
