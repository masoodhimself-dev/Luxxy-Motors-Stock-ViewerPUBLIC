import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import type { DealerConfig } from '@/config/dealer';
import { formatPhoneDisplay, vehicleDisplayTitle } from '@/lib/utils';
import { vehiclePrintData, type VehiclePrintFact } from '@/lib/vehicle-print-data';

const supplied = (value?: string) => {
  const text = value?.trim();
  return text && !/^(not supplied|not provided|unknown|n\/a|your dealership|your address|enter .+|\[.+\])$|\b(?:sample (?:address|postcode|phone|email)|example (?:road|street|address)|placeholder)\b/i.test(text) ? text : '';
};
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

function Facts({ facts }: { facts: VehiclePrintFact[] }) {
  return <dl>{facts.map(({ label, value }) => <div key={`${label}:${value}`} className={value.length > 60 ? 'vehicle-print-wide-fact' : undefined}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

/** Full supplied information, measured at its physical print size before opening the print dialog. */
export function VehiclePrint({ car, dealer, features, description }: { car: Car; dealer: DealerConfig; features: string[]; description?: string }) {
  const sheet = useRef<HTMLElement>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [failedPhotos, setFailedPhotos] = useState<string[]>([]);
  const [failedLogo, setFailedLogo] = useState(false);
  const data = useMemo(() => vehiclePrintData(car, features, description), [car, features, description]);
  const photos = data.photos.filter(photo => !failedPhotos.includes(photo.src));
  const heroGallery = !data.description && !data.features.length && photos.length === 3;
  const name = supplied(dealer.identity.name);
  const phone = supplied(dealer.contact.phone);
  const email = supplied(dealer.contact.email);
  const printedEmail = email && !/@(?:example\.(?:com|org|net)|[^@]+\.(?:test|invalid))$/i.test(email) ? email : '';
  const address = [dealer.address?.street, dealer.address?.city, dealer.address?.region, dealer.address?.postcode].map(supplied).filter(Boolean).join(', ');
  const url = `${window.location.origin}/vehicle/${encodeURIComponent(car.id)}`;
  const accent = /^#[0-9a-f]{6}$/i.test(dealer.brochure?.accentColour ?? '') ? dealer.brochure!.accentColour : '#263c46';
  const legal = [supplied(dealer.legal.companyNumber) ? `Company no. ${dealer.legal.companyNumber}` : '', supplied(dealer.legal.vatNumber) ? `VAT no. ${dealer.legal.vatNumber}` : ''].filter(Boolean).join(' · ');

  const fit = useCallback(() => {
    const element = sheet.current;
    const page = element?.querySelector<HTMLElement>('.vehicle-print-page');
    if (!element || !page) return false;
    // Compact whitespace and photographs before reducing type; never clip or truncate content.
    for (const density of ['comfortable', 'compact', 'catalogue', 'dense', 'extra-dense']) {
      element.dataset.printDensity = density;
      if (page.getBoundingClientRect().height <= element.clientHeight + 1) {
        element.dataset.printReady = 'true';
        return true;
      }
    }
    element.dataset.printReady = 'false';
    return false;
  }, []);

  useEffect(() => {
    setFailedLogo(false);
  }, [dealer.identity.logoAsset]);

  useEffect(() => {
    setFailedPhotos([]);
    setError('');
    const beforePrint = () => { if (sheet.current) { sheet.current.dataset.measuring = 'true'; fit(); delete sheet.current.dataset.measuring; } };
    window.addEventListener('beforeprint', beforePrint);
    return () => window.removeEventListener('beforeprint', beforePrint);
  }, [car.id, fit]);

  const print = async () => {
    if (!sheet.current) return;
    setPreparing(true);
    setError('');
    sheet.current.dataset.measuring = 'true';
    try {
      // This sheet uses local Arial/Helvetica; unrelated website font downloads must not delay printing.
      await Promise.race([
        Promise.allSettled(Array.from(sheet.current.querySelectorAll('img')).map(img => img.decode())),
        new Promise(resolve => setTimeout(resolve, 6000)),
      ]);
      // Decode failures remove the photograph entirely, including its frame and caption.
      setFailedPhotos(current => [...new Set([...current, ...Array.from(sheet.current!.querySelectorAll<HTMLImageElement>('.vehicle-print-photo img')).filter(img => !img.complete || !img.naturalWidth).map(img => img.getAttribute('src') || img.src)])]);
      await nextFrame();
      await nextFrame();
      if (!fit()) {
        setError('These details exceed one readable A4 page. Please contact the showroom for a complete vehicle sheet.');
        return;
      }
      delete sheet.current.dataset.measuring;
      window.print();
    } finally {
      if (sheet.current) delete sheet.current.dataset.measuring;
      setPreparing(false);
    }
  };

  return <>
    <button id="print-vehicle-details" type="button" className="text-link min-h-11 text-sm" onClick={print} disabled={preparing} data-testid="button-print-vehicle" aria-label={`Print vehicle details for ${vehicleDisplayTitle(car)}`}><Printer aria-hidden="true" className="h-4 w-4" />{preparing ? 'Preparing print…' : 'Print vehicle details'}</button>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {createPortal(<article ref={sheet} className="vehicle-print-sheet" data-print-density="comfortable" data-print-gallery={heroGallery ? 'hero' : 'strip'} aria-label="Printable vehicle details" style={{ '--vehicle-print-accent': accent } as CSSProperties}>
      <div className="vehicle-print-page">
        <header className="vehicle-print-brand">
          <div className="vehicle-print-identity">
            {dealer.identity.logoAsset && !failedLogo ? <img src={dealer.identity.logoAsset} alt={name} onError={() => setFailedLogo(true)} /> : name && <strong>{name}</strong>}
            <span>Vehicle details</span>
          </div>
          {(phone || printedEmail) && <div className="vehicle-print-contact">{phone && <p>{formatPhoneDisplay(phone)}</p>}{printedEmail && <p>{printedEmail}</p>}</div>}
        </header>
        <section className="vehicle-print-title"><div>{data.title && <h1>{data.title}</h1>}{data.variant && <p>{data.variant}</p>}</div>{data.price && <div className="vehicle-print-price"><span>Vehicle price</span><strong>{data.price}</strong>{data.priceNote && <small>{data.priceNote}</small>}</div>}</section>
        {photos.length > 0 && <div className="vehicle-print-photos" style={{ gridTemplateColumns: heroGallery ? '2fr 1fr' : `repeat(${photos.length}, minmax(0, 1fr))` }}>{photos.map(({ src, caption }) => <figure key={src} className="vehicle-print-photo"><img src={src} alt={caption || ''} referrerPolicy="no-referrer" onError={() => setFailedPhotos(current => current.includes(src) ? current : [...current, src])} />{caption && <figcaption>{caption}</figcaption>}</figure>)}</div>}
        {data.facts.length > 0 && <section className="vehicle-print-facts" aria-label="Vehicle at a glance"><Facts facts={data.facts} /></section>}
        {data.description && <section className="vehicle-print-description"><h2>Dealer description · as supplied</h2><p>{data.description}</p></section>}
        {data.features.length > 0 && <section className="vehicle-print-features"><h2>Features & equipment</h2><ul>{data.features.map(feature => <li key={feature}>{feature}</li>)}</ul></section>}
        {(data.specificationGroups.length > 0 || data.runningCosts.length > 0) && <div className="vehicle-print-specifications">
          {data.specificationGroups.map(group => <section key={group.title}><h2>{group.title}</h2><Facts facts={group.facts} /></section>)}
          {data.runningCosts.length > 0 && <section><h2>Running costs · published figures</h2><Facts facts={data.runningCosts} /></section>}
        </div>}
        {data.history.length > 0 && <section className="vehicle-print-history"><h2>History & supplied information</h2><Facts facts={data.history} /></section>}
        {data.sourceNotes.length > 0 && <aside className="vehicle-print-source-notes"><h2>Source information to confirm</h2>{data.sourceNotes.map(note => <p key={note}>{note}</p>)}</aside>}
        <footer className="vehicle-print-footer">
          {address && <strong>{address}</strong>}
          <a href={url}>{url}</a>
          {legal && <p>{legal}</p>}
          {supplied(dealer.brochure?.footerNote) && <p>{dealer.brochure!.footerNote}</p>}
          <small>Printed {new Date().toLocaleDateString('en-GB')} · Supplied listing details. Confirm price, availability and vehicle information with the showroom before purchase.</small>
        </footer>
      </div>
    </article>, document.body)}
  </>;
}
