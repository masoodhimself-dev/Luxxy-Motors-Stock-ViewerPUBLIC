import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import type { DealerConfig } from '@/config/dealer';
import { formatMileage, formatPrice, getSafeImageUrl, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { insuranceHistoryLabel } from '@/lib/vehicle-history';
const short = (value: string, length: number) => value.length > length ? `${value.slice(0, length - 1).trim()}…` : value;

export function VehiclePrint({ car, dealer, features, description }: { car: Car; dealer: DealerConfig; features: string[]; description?: string }) {
  const sheet = useRef<HTMLElement>(null);
  const [preparing, setPreparing] = useState(false);
  const photos = Array.from(new Set([getThumbnailUrl(car), ...(car.images ?? []).map(getSafeImageUrl)].filter(Boolean))).slice(0, 3);
  const title = [car.year, vehicleDisplayTitle(car)].filter(Boolean).join(' ');
  const address = [dealer.address?.street, dealer.address?.city, dealer.address?.postcode].filter(Boolean).join(', ');
  const url = `${window.location.origin}/vehicle/${encodeURIComponent(car.id)}`;
  const facts = [
    ['Year', car.year?.toString()], ['Engine', car.engineSize || (car.engineCC ? `${car.engineCC}cc` : '')],
    ['Body', car.bodyType], ['Gearbox', car.transmission], ['Fuel', car.fuel],
    ['Mileage', car.mileage != null ? formatMileage(car.mileage) : car.mileageText],
  ];
  const print = async () => {
    setPreparing(true);
    try {
      await Promise.race([
        Promise.allSettled(Array.from(sheet.current?.querySelectorAll('img') ?? []).map(img => img.decode())),
        new Promise(resolve => setTimeout(resolve, 6000)),
      ]);
      await document.fonts.ready;
      window.print();
    } finally { setPreparing(false); }
  };
  return <>
    <button type="button" className="text-link min-h-11 text-sm" onClick={print} disabled={preparing} data-testid="button-print-vehicle" aria-label={`Print vehicle details for ${vehicleDisplayTitle(car)}`}><Printer aria-hidden="true" className="h-4 w-4" />{preparing ? 'Preparing print…' : 'Print vehicle details'}</button>
    {createPortal(<article ref={sheet} className="vehicle-print-sheet" aria-label="Printable vehicle details">
      <header className="vehicle-print-brand"><strong>{short(dealer.identity.name, 65)}</strong><div>{dealer.contact.phone && <p>{dealer.contact.phone}</p>}{dealer.contact.email && <p>{short(dealer.contact.email, 65)}</p>}</div></header>
      <div className={`vehicle-print-photos ${photos.length < 2 ? 'vehicle-print-single' : ''}`}>
        {photos.length ? photos.map((src, index) => <div key={src} className={`vehicle-print-photo vehicle-print-photo-${index}`}><img src={src} alt={`Vehicle photograph ${index + 1}`} referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none'; }} /><span>Photograph unavailable</span></div>) : <p>Vehicle photographs not supplied</p>}
      </div>
      <section className="vehicle-print-title"><div><h1>{short(title, 110)}</h1><p>{short(car.variant || car.trim || '', 120)}</p></div><strong>{car.price != null ? formatPrice(car.price, car.currency) : 'Price on application'}</strong></section>
      <dl className="vehicle-print-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{short(value || 'Not supplied', 34)}</dd></div>)}</dl>
      <p className="vehicle-print-history">Insurance history: {car.writeOffCategory ? insuranceHistoryLabel(car.writeOffCategory) : 'Not supplied — ask the dealership'}. {car.inventoryStatus ? `Status: ${car.inventoryStatus}.` : ''}</p>
      <section className="vehicle-print-features"><h2>Features & equipment</h2>{features.length ? <><ul>{features.slice(0, 15).map((feature, index) => <li key={index}>{short(feature, 68)}</li>)}</ul>{features.length > 15 && <p>+ {features.length - 15} more features on the vehicle page.</p>}</> : <p>Contact the dealership for the full specification.</p>}</section>
      <section className="vehicle-print-description"><h2>About this vehicle</h2><p>{short(description?.replace(/\s+/g, ' ').trim() || 'Please contact the dealership for the vehicle description, history and preparation details.', 650)}</p></section>
      <footer className="vehicle-print-footer"><strong>{short(address || dealer.identity.name, 150)}</strong><p>{url}</p><small>Printed {new Date().toLocaleDateString('en-GB')}. This is a summary. Check the full vehicle information, price and availability with the dealership before purchase.</small></footer>
    </article>, document.body)}
  </>;
}
