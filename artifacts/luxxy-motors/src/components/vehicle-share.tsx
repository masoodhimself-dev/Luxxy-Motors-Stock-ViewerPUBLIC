import { useEffect, useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import type { Car } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getVehicleShareUrl } from '@/lib/cta-helpers';
import { formatMileage, formatPrice, vehicleDisplayTitle } from '@/lib/utils';
import { copyShareLink, saveShareBlob, sharePhotos, vehicleShareChannels, vehicleSharePriceNote, vehicleShareText } from '@/lib/vehicle-share';
import { trackEvent } from '@/lib/analytics';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './ui/dialog';
import { ChevronDown, ChevronRight, Copy, Download, FileText, Image as ImageIcon, Mail, QrCode, Share2, SiWhatsapp } from './icons';
import { DealerWordmark } from './brand/wordmark';
import { VehiclePrint } from './vehicle-print';
import { useVehicleDialogTheme } from './vehicle-dialog-vehicle';
import './vehicle-share.css';
import type { VehicleShareImageFormat } from '@/lib/vehicle-share-image';

export function VehicleShare({ car }: { car: Car }) {
  const { settings } = useDealerSettings();
  const theme = useVehicleDialogTheme();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [panel, setPanel] = useState<'qr' | 'image' | null>(null);
  const [photo, setPhoto] = useState('');
  const [imageFormat, setImageFormat] = useState<VehicleShareImageFormat>('square');
  const [busy, setBusy] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const controller = useRef<AbortController | null>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const qr = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const photos = sharePhotos(car), selectedPhoto = photo || photos[0];
  const url = getVehicleShareUrl(car), label = vehicleDisplayTitle(car);
  const channels = vehicleShareChannels(car, url);
  const sourceSignature = JSON.stringify([car, settings.identity.name, settings.identity.logoAsset, url]);
  function clearPreparedImage() {
    const pending = controller.current; controller.current = null; pending?.abort();
    setBusy(false); setImageBlob(null); setImageUrl('');
  }
  useEffect(() => { clearPreparedImage(); setPhoto(''); setStatus(''); }, [sourceSignature]);
  useEffect(() => () => { const pending = controller.current; controller.current = null; pending?.abort(); }, []);
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }, [imageUrl]);
  function changeOpen(next: boolean) {
    setOpen(next); setStatus('');
    clearPreparedImage();
  }
  function action(channel: string) { trackEvent('vehicle_share_action', { channel }); }
  async function copy() {
    const copied = await copyShareLink(url, linkInput.current);
    setStatus(copied ? 'Link copied' : 'Select and copy the link below.');
    if (copied) action('copy');
  }
  async function deviceShare() {
    try { await navigator.share({ title: label, text: vehicleShareText(car), url }); action('device'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('Sharing could not open. You can copy the link instead.'); }
  }
  function downloadQr() {
    qr.current?.querySelector('canvas')?.toBlob(blob => {
      if (blob) { saveShareBlob(blob, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-qr.png`); action('qr_download'); }
      else setStatus('The QR code could not be saved. You can still scan it here.');
    });
  }
  async function prepareImage() {
    if (!selectedPhoto || busy) return;
    const request = new AbortController(); controller.current?.abort(); controller.current = request;
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; request.abort(); }, 20_000);
    setBusy(true); setStatus(''); setImageBlob(null); setImageUrl('');
    try {
      const { createVehicleShareImage } = await import('@/lib/vehicle-share-image');
      const blob = await createVehicleShareImage(car, selectedPhoto, settings, url, request.signal, imageFormat);
      if (controller.current === request && !request.signal.aborted) { setImageBlob(blob); setImageUrl(URL.createObjectURL(blob)); }
    } catch (error) {
      if (controller.current === request && (!request.signal.aborted || timedOut)) setStatus(timedOut ? 'The image took too long. Please try again.' : error instanceof Error ? error.message : 'The image could not be prepared. Please try again.');
    } finally { clearTimeout(timer); if (controller.current === request) { controller.current = null; setBusy(false); } }
  }
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><button type="button" className="vehicle-share-trigger" aria-label="Share this vehicle"><Share2 size={18} />Share</button></DialogTrigger>
    <DialogContent style={theme} className="vehicle-share-dialog" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}>
      <DialogTitle ref={titleRef}>Share this car</DialogTitle>
      <DialogDescription className="sr-only">Send this car to someone, copy its link or save its details.</DialogDescription>
      <div className="vehicle-share-summary">
        {photos[0] && <img src={photos[0]} alt={label} width={210} height={155} />}
        <div><h3>{label}</h3>{(car.variant || car.trim) && <p>{car.variant || car.trim}</p>}<p>{[car.year, car.mileage != null ? formatMileage(car.mileage) : car.mileageText].filter(Boolean).join(' · ')}</p><strong>{car.price != null ? formatPrice(car.price, car.currency) : 'Price on application'}</strong>{vehicleSharePriceNote(car) && <p>{vehicleSharePriceNote(car)}</p>}</div>
      </div>
      <div className="vehicle-share-primary">
        <a href={channels.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => action('whatsapp_opened')}><SiWhatsapp size={23} />WhatsApp</a>
        <button type="button" onClick={() => void copy()}><Copy size={23} />Copy link</button>
        <a href={channels.email} onClick={() => action('email_opened')}><Mail size={23} />Email</a>
      </div>
      <label className="vehicle-share-link">Link to this car<input ref={linkInput} readOnly value={url} onFocus={event => event.target.select()} aria-label="Link to this car" /></label>
      <details className="vehicle-share-extras">
        <summary>More ways to share<ChevronDown size={18} /></summary>
        <button type="button" className="vehicle-share-option" aria-expanded={panel === 'qr'} onClick={() => setPanel(panel === 'qr' ? null : 'qr')}><QrCode /><span><strong>Show QR code</strong><small>Open this car on another phone</small></span><ChevronRight size={17} /></button>
        {panel === 'qr' && <div className="vehicle-share-qr" ref={qr}><QRCodeCanvas value={url} size={200} marginSize={4} title={`QR code for ${label}`} /><button type="button" onClick={downloadQr}><Download size={17} />Save QR code</button></div>}
        <VehiclePrint car={car} dealer={settings} features={[]} triggerClassName="vehicle-share-option" triggerContent={<><FileText /><span><strong>Car details PDF</strong><small>Download or print the photo, price and details</small></span><ChevronRight size={17} /></>} />
        {photos.length > 0 && <button type="button" className="vehicle-share-option" aria-expanded={panel === 'image'} onClick={() => setPanel(panel === 'image' ? null : 'image')}><ImageIcon /><span><strong>Create a share image</strong><small>A photo and price for your status or story</small></span><ChevronRight size={17} /></button>}
        {panel === 'image' && <div className="vehicle-share-image">
          <fieldset className="vehicle-share-format"><legend>Image shape</legend><label><input type="radio" name="share-image-format" value="square" checked={imageFormat === 'square'} disabled={busy} onChange={() => { setImageFormat('square'); clearPreparedImage(); }} />Square</label><label><input type="radio" name="share-image-format" value="portrait" checked={imageFormat === 'portrait'} disabled={busy} onChange={() => { setImageFormat('portrait'); clearPreparedImage(); }} />Portrait / story</label></fieldset><p>Choose a photo</p><div className="vehicle-share-photos" aria-label="Choose a share photo">{photos.map((item, index) => <button type="button" key={item} disabled={busy} aria-label={`Use photo ${index + 1}`} aria-pressed={selectedPhoto === item} onClick={() => { setPhoto(item); setImageBlob(null); setImageUrl(''); }}><img src={item} alt="" loading="lazy" width={96} height={72} /></button>)}</div>
          {imageUrl && <img className="vehicle-share-image-preview" src={imageUrl} alt={`Share image for ${label}`} />}
          {imageBlob ? <button type="button" className="vehicle-share-image-save" onClick={() => { saveShareBlob(imageBlob, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${imageFormat}.png`); action('image_download'); }}><Download size={18} />Save image</button> : <button type="button" className="vehicle-share-image-save" disabled={busy} onClick={() => void prepareImage()}>{busy ? 'Preparing image…' : 'Preview image'}</button>}
        </div>}
      </details>
      {status && <p role="status" className="vehicle-share-status">{status}</p>}
      <footer className="vehicle-share-footer"><DealerWordmark name={settings.identity.name} logoAsset={settings.identity.logoAsset} />{typeof navigator.share === 'function' && <button type="button" onClick={() => void deviceShare()}><Share2 size={18} />More apps</button>}</footer>
    </DialogContent>
  </Dialog>;
}
