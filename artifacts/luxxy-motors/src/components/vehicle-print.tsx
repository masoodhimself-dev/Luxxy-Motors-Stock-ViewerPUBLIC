import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Printer } from '@/components/icons';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { Car } from '@/lib/stock-context';
import type { DealerConfig } from '@/config/dealer';
import { vehicleDisplayTitle } from '@/lib/utils';
import { buildVehicleSheetData, vehicleSheetLocation } from '@/lib/vehicle-sheet-data';

/** An isolated A4 document: its fonts and print rules cannot reach invoices. */
export function VehiclePrint({ car, dealer, features, description }: { car: Car; dealer: DealerConfig; features: string[]; description?: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'preparing'|'ready'|'error'>('preparing');
  const [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement | null>(null);
  // A stable ref callback starts preparation after the dialog portal has mounted.
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open || !container) return;
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
        // Keyboard events in the sheet's iframe do not bubble to the dialog.
        doc.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
        }, { signal: controller.signal });
        const { origin, url } = vehicleSheetLocation(car.id);
        const data = buildVehicleSheetData(car, dealer, features, description, url);
        if (data.dealer?.logoUrl) data.dealer.logoUrl = new URL(data.dealer.logoUrl, window.location.origin).href;
        const { prepareVehicleSheet } = await import('@/lib/vehicle-sheet/controller');
        if (controller.signal.aborted) return;
        const result = await prepareVehicleSheet(doc.querySelector('main')!, data, { dealerWebsiteOrigin: origin, vehiclePathPrefix: '/vehicle/' }, controller.signal);
        if (controller.signal.aborted) return;
        setStatus(result.status === 'ready' ? 'ready' : 'error');
        if (result.status !== 'ready') setError(result.message || 'The vehicle sheet could not be prepared. Please try again.');
      } catch {
        if (!controller.signal.aborted) { setStatus('error'); setError('The vehicle sheet could not be prepared. Please try again.'); }
      }
    })();
    return () => { controller.abort(); observer.disconnect(); element.remove(); if (frame.current === element) frame.current = null; };
  }, [open, container, car, dealer, features, description]);
  return <>
    <button id="print-vehicle-details" type="button" className="text-link min-h-11 text-sm" onClick={() => { setStatus('preparing'); setOpen(true); }} data-testid="button-print-vehicle" aria-label={`Print vehicle details for ${vehicleDisplayTitle(car)}`}><Printer aria-hidden="true" className="h-4 w-4" />Print vehicle details</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-4xl p-4 sm:p-6">
        <DialogHeader><DialogTitle>Vehicle details</DialogTitle><DialogDescription>One A4 page. Scan the QR code for the full description, equipment and photos.</DialogDescription></DialogHeader>
        <Button type="button" className="min-h-11 justify-self-start" disabled={status !== 'ready'} onClick={() => { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }}><Printer className="h-4 w-4" aria-hidden="true" />Print A4 sheet</Button>
        {status === 'preparing' && <p role="status">Preparing your sheet…</p>}
        {status === 'error' && <p role="alert" className="text-destructive">{error}</p>}
        <div className="min-w-0 overflow-hidden bg-muted" aria-busy={status === 'preparing'}><div ref={setContainer} className="relative w-full max-w-[794px] mx-auto" /></div>
      </DialogContent>
    </Dialog>
  </>;
}
