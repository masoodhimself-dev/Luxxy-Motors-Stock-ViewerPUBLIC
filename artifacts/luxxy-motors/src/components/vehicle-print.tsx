import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import type { MotHistory } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Printer } from '@/components/icons';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Car } from '@/lib/stock-context';
import type { DealerConfig } from '@/config/dealer';
import { vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { vehicleContent } from '@/lib/vehicle-content';
import { buildVehicleSheetData, vehicleSheetLocation } from '@/lib/vehicle-sheet-data';

const CHECK_ERROR = 'We couldn’t check the current price and availability. Please try again before printing or downloading.';
const UNAVAILABLE = 'This vehicle is no longer available to print. Please return to the stock page for current cars.';

/** Never silently print an old or unrelated advert after a failed check. */
export function checkedVehicleSheetCar(value: unknown, id: string): Car {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(CHECK_ERROR);
  const car = value as Car;
  if (car.id !== id || !Array.isArray(car.images)
    || ![car.title, car.make, car.model].some(value => typeof value === 'string' && value.trim())
    || !(car.price === null || typeof car.price === 'number' && Number.isFinite(car.price) && car.price >= 0)) throw new Error(CHECK_ERROR);
  if (['sold', 'unavailable', 'withdrawn', 'archived'].includes(String(car.inventoryStatus).toLowerCase())
    || car.sourceExtras?.websiteSourceStatus === 'missing') throw new Error(UNAVAILABLE);
  return car;
}

/** An isolated A4 document: its fonts and PDF export cannot reach invoices. */
export function VehiclePrint({ car, dealer, features: _features, description: _description }: { car: Car; dealer: DealerConfig; features: string[]; description?: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'checking' | 'preparing' | 'ready' | 'error'>('checking');
  const [error, setError] = useState('');
  const [monochrome, setMonochrome] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [fresh, setFresh] = useState<{ car: Car; history: MotHistory | null } | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const downloadController = useRef<AbortController | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
    setFresh(null); setStatus('checking'); setError('');
    void (async () => {
      try {
        const checked = checkedVehicleSheetCar(await customFetch<unknown>(`/api/vehicles/${encodeURIComponent(car.id)}`, { signal: controller.signal, cache: 'no-store' }), car.id);
        clearTimeout(timer);
        let history: MotHistory | null = null;
        // Cache read only: printing never starts a DVSA lookup.
        if (vehicleRegistration(checked)) {
          const motController = new AbortController();
          const cancelMot = () => motController.abort();
          controller.signal.addEventListener('abort', cancelMot, { once: true });
          const motTimer = setTimeout(cancelMot, 2500);
          try {
            const reply = await customFetch<{ status: string; history?: MotHistory }>(`/api/vehicles/${encodeURIComponent(car.id)}/mot-history?cacheOnly=true`, { signal: motController.signal, cache: 'no-store' });
            const candidate = reply.history;
            if (reply.status === 'available' && candidate && typeof candidate.registration === 'string'
              && typeof candidate.checkedAt === 'string' && Array.isArray(candidate.tests)
              && candidate.tests.every(test => test && typeof test.completedDate === 'string')) history = candidate;
          } catch { /* An optional MOT line must not block a current car sheet. */ }
          finally { clearTimeout(motTimer); controller.signal.removeEventListener('abort', cancelMot); }
        }
        if (controller.signal.aborted) {
          if (timedOut) throw new Error(CHECK_ERROR);
          return;
        }
        setFresh({ car: checked, history }); setStatus('preparing');
      } catch (caught) {
        if (controller.signal.aborted && !timedOut) return;
        const notFound = caught && typeof caught === 'object' && 'status' in caught && caught.status === 404;
        setError(notFound || caught instanceof Error && caught.message === UNAVAILABLE ? UNAVAILABLE : CHECK_ERROR);
        setStatus('error');
      } finally { clearTimeout(timer); }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, car.id, retry]);

  useEffect(() => {
    if (!open || !container || !fresh || fresh.car.id !== car.id) return;
    const controller = new AbortController();
    const element = document.createElement('iframe');
    element.title = 'Printable vehicle details';
    Object.assign(element.style, { width: '210mm', height: '297mm', border: '0', transformOrigin: 'top left', position: 'absolute', top: '0', left: '0', background: 'white' });
    container.appendChild(element); frame.current = element;
    const size = () => {
      const scale = Math.min(1, container.clientWidth / (210 * 96 / 25.4));
      element.style.transform = `scale(${scale})`;
      container.style.height = `${297 * 96 / 25.4 * scale}px`;
    };
    const observer = new ResizeObserver(size); observer.observe(container); size();
    setStatus('preparing'); setError('');
    void (async () => {
      try {
        const doc = element.contentDocument!;
        doc.open(); doc.write('<!doctype html><html><head><meta charset="utf-8"><title>Vehicle details</title><style>html,body{margin:0;padding:0;background:white}</style></head><body><main></main></body></html>'); doc.close();
        doc.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        }, { signal: controller.signal });
        const { origin, url } = vehicleSheetLocation(fresh.car.id);
        const content = vehicleContent(fresh.car);
        const data = buildVehicleSheetData(fresh.car, dealer, content.features, content.description, url, fresh.history ?? undefined);
        if (data.dealer?.logoUrl) data.dealer.logoUrl = new URL(data.dealer.logoUrl, window.location.origin).href;
        const { prepareVehicleSheet } = await import('@/lib/vehicle-sheet/controller');
        if (controller.signal.aborted) return;
        const result = await prepareVehicleSheet(doc.querySelector('main')!, data, { dealerWebsiteOrigin: origin, vehiclePathPrefix: '/vehicle/', monochrome }, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(result.status === 'ready' ? 'ready' : 'error');
        if (result.status !== 'ready') setError('The vehicle sheet could not fit safely on one A4 page. Please try again or contact the dealership for details.');
      } catch {
        if (!controller.signal.aborted) { setStatus('error'); setError('The vehicle sheet could not be prepared. Please try again.'); }
      }
    })();
    return () => { controller.abort(); observer.disconnect(); element.remove(); if (frame.current === element) frame.current = null; };
  }, [open, container, fresh, car.id, dealer, monochrome]);

  useEffect(() => {
    setDownloading(false);
    return () => { downloadController.current?.abort(); downloadController.current = null; };
  }, [open, car.id]);
  const ready = status === 'ready' && fresh?.car.id === car.id && !downloading;
  async function download() {
    const doc = frame.current?.contentDocument;
    if (!ready || !doc || !fresh) return;
    const controller = new AbortController(); downloadController.current = controller;
    setDownloading(true); setError('');
    try {
      const { saveVehicleSheetPdf, vehicleSheetPdfFilename } = await import('@/lib/vehicle-sheet/pdf');
      await saveVehicleSheetPdf(doc, vehicleSheetPdfFilename(`${vehicleDisplayTitle(fresh.car)} ${vehicleRegistration(fresh.car) || ''}`), controller.signal);
    } catch {
      if (!controller.signal.aborted) setError('The PDF could not be downloaded. Please try again or use Print A4 sheet.');
    } finally { if (downloadController.current === controller) { downloadController.current = null; setDownloading(false); } }
  }
  return <>
    <button id="print-vehicle-details" type="button" className="text-link min-h-11 text-sm" onClick={() => { setStatus('checking'); setError(''); setOpen(true); }} data-testid="button-print-vehicle" aria-label={`Print vehicle details for ${vehicleDisplayTitle(car)}`}><Printer aria-hidden="true" className="h-4 w-4" />Print vehicle details</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl p-4 sm:p-6">
        <DialogHeader><DialogTitle>Vehicle details</DialogTitle><DialogDescription>One A4 page. Scan the QR code for the full description, equipment and photos.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="min-h-11" disabled={!ready} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}><Printer className="h-4 w-4" aria-hidden="true" />Print A4 sheet</Button>
          <Button type="button" variant="outline" className="min-h-11" disabled={!ready} onClick={() => void download()}>{downloading ? 'Preparing PDF…' : 'Download PDF'}</Button>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 px-2 text-sm"><input type="checkbox" checked={monochrome} disabled={downloading} onChange={event => setMonochrome(event.target.checked)} className="h-4 w-4 accent-current" />Ink-saving</label>
        </div>
        {(status === 'checking' || status === 'preparing') && <p role="status">{status === 'checking' ? 'Checking current price and availability…' : 'Preparing your sheet…'}</p>}
        {status === 'ready' && <p className="text-xs text-muted-foreground">Price and availability checked for this sheet.</p>}
        {error && <div><p role="alert" className="text-destructive">{error}</p>{status === 'error' && <Button type="button" variant="outline" className="mt-2 min-h-11" onClick={() => setRetry(value => value + 1)}>Try again</Button>}</div>}
        <div className="min-w-0 overflow-hidden bg-muted" aria-busy={status === 'checking' || status === 'preparing'}><div ref={setContainer} className="relative w-full max-w-[794px] mx-auto" /></div>
      </DialogContent>
    </Dialog>
  </>;
}
