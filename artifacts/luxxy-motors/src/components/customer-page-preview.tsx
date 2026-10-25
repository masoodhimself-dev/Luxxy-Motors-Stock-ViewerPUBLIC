import { useEffect, useMemo, useState } from 'react';
import type { DealerSettings } from '@workspace/api-client-react';
import { useStock } from '@/lib/stock-context';
import { useDealerFeatures } from '@/lib/dealer-features';
import { vehicleDisplayTitle } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { customerPreviewDocument, loadedPreviewStyles, renderCustomerPagePreview, type PreviewPage } from './customer-page-preview-renderer';
import './customer-page-preview.css';

const devices = [
  { label: 'Phone', width: 390, height: 844 },
  { label: 'iPad', width: 820, height: 1180 },
  { label: 'Desktop', width: 1440, height: 900 },
] as const;

export default function CustomerPagePreview({ settings, onClose }: { settings: DealerSettings; onClose: () => void }) {
  const { stock, isLoading, error } = useStock();
  const features = useDealerFeatures();
  const [page, setPage] = useState<PreviewPage>('home');
  const [device, setDevice] = useState<(typeof devices)[number]>(devices[0]);
  const [vehicleId, setVehicleId] = useState('');
  const [stageWidth, setStageWidth] = useState(390);
  const [snapshot, setSnapshot] = useState<{ request: object; html: string } | null>(null);
  const [renderError, setRenderError] = useState(false);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const cars = useMemo(() => (stock?.cars ?? []).filter(car => !['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus).toLowerCase())), [stock?.cars]);
  const selectedVehicle = cars.find(car => car.id === vehicleId)?.id ?? cars[0]?.id;
  const available = Boolean(stock && features.data && !error && !features.isError);
  // Bind markup to the exact inputs. A new iframe must never mount with the previous
  // page's HTML and rely on a second srcDoc navigation to correct it (WebKit can retain it).
  const request = useMemo(() => ({ settings, stock, features: features.data, available, page, viewportWidth: device.width, vehicleId: selectedVehicle }), [settings, stock, features.data, available, page, device.width, selectedVehicle]);
  const currentSnapshot = snapshot?.request === request ? snapshot.html : null;

  useEffect(() => {
    const element = stage;
    if (!element) return;
    const update = () => setStageWidth(element.clientWidth || 390);
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [stage]);

  useEffect(() => {
    setSnapshot(null);
    setRenderError(false);
    if (!available || !stock || !features.data || (page === 'vehicle' && !selectedVehicle)) return;
    try {
      const markup = renderCustomerPagePreview({ settings, stock, features: features.data, page, viewportWidth: device.width, vehicleId: selectedVehicle });
      setSnapshot({ request, html: customerPreviewDocument(markup, loadedPreviewStyles(document)) });
    } catch {
      setRenderError(true);
    }
  }, [request]);
  const scale = Math.min(1, stageWidth / device.width);

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="customer-page-preview-dialog" aria-describedby="full-website-preview-description">
      <div className="customer-page-preview-heading"><DialogTitle>Preview your customer website</DialogTitle><DialogDescription id="full-website-preview-description">Unpublished draft with current stock. Read-only: links, forms and buttons are disabled; information sections can be opened. Live booking times, video playback and demo banners are not included.</DialogDescription></div>
      <div className="customer-page-preview-controls">
        <label><span>Page</span><select aria-label="Preview page" value={page} onChange={event => setPage(event.target.value as PreviewPage)}><option value="home">Homepage</option><option value="stock">Stock</option><option value="vehicle" disabled={!cars.length}>Vehicle</option><option value="contact">Contact</option><option value="warranty">Warranty</option></select></label>
        {page === 'vehicle' && <label className="customer-page-preview-vehicle"><span>Vehicle</span><select aria-label="Preview vehicle" value={selectedVehicle ?? ''} onChange={event => setVehicleId(event.target.value)}>{cars.map(car => <option key={car.id} value={car.id}>{vehicleDisplayTitle(car)}{car.plate ? ` · ${car.plate}` : ''}</option>)}</select></label>}
        <div role="group" aria-label="Preview screen size" className="customer-page-preview-devices">{devices.map(option => <Button key={option.label} type="button" size="sm" variant={device.label === option.label ? 'default' : 'outline'} aria-pressed={device.label === option.label} onClick={() => setDevice(option)}>{option.label}</Button>)}</div>
      </div>
      <p className="customer-page-preview-dimensions">{device.width} × {device.height} px{scale < 1 ? ` · scaled to ${Math.round(scale * 100)}% to fit this screen` : ''} · Scroll inside the preview to see the full page.</p>
      <div className="customer-page-preview-stage" ref={setStage}>
        {isLoading || features.isLoading ? <p role="status">Loading current stock and website access…</p> : !available ? <p role="alert">Current stock or website access could not be loaded. Close the preview and try again; no example cars or guessed access settings are shown.</p> : page === 'vehicle' && !selectedVehicle ? <p role="status">No current vehicle is available to preview. Choose another page.</p> : renderError ? <p role="alert">This page could not be previewed. Your draft is unchanged. Close the preview and try again.</p> : currentSnapshot ? <div className="customer-page-preview-frame-space" style={{ width: device.width * scale, height: device.height * scale }}><iframe key={`${page}-${device.width}-${selectedVehicle}`} title={`${device.label} ${page} unpublished preview`} sandbox="" referrerPolicy="no-referrer" srcDoc={currentSnapshot} width={device.width} height={device.height} style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }} /></div> : null}
      </div>
      <p className="customer-page-preview-note">This preview does not save or publish changes, contact customers or record website visits.</p>
    </DialogContent>
  </Dialog>;
}
