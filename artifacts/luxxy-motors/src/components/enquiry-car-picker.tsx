import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Car } from '@/lib/stock-context';
import { formatMileage, formatPrice, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { enquiryDraftKey, readEnquiryDraft } from '@/lib/enquiry-draft';
import { formatRegistrationPlate } from '@/lib/registration-display';
import { Camera, Check, Search, X } from '@/components/icons';
import { MakeLogo } from './make-logo';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import './enquiry-car-picker.css';

function CarPhoto({ car }: { car: Car }) {
  const src = getThumbnailUrl(car);
  const [failed, setFailed] = useState('');
  return <span className="enquiry-car-picker__photo">{src && failed !== src ? <img src={src} loading="lazy" alt="" onError={() => setFailed(src)} /> : <Camera aria-hidden="true" />}</span>;
}

export function EnquiryCarPicker({ open, onOpenChange, cars, currentId, onSelect, purpose = 'enquiry', returnFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cars: Car[];
  currentId?: string;
  onSelect: (car: Car, carryCurrent: boolean) => void;
  purpose?: 'enquiry' | 'part-exchange';
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [savedCar, setSavedCar] = useState<Car | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const savedTitle = useRef<HTMLHeadingElement>(null);
  const returnToSearch = useRef(false);
  useEffect(() => { if (open) { setQuery(''); setSavedCar(null); } }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    if (savedCar) savedTitle.current?.focus({ preventScroll: true });
    else if (returnToSearch.current) {
      returnToSearch.current = false;
      search.current?.focus({ preventScroll: true });
    }
  }, [open, savedCar]);
  const choices = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return cars.filter(car => {
      if (car.inventoryStatus === 'sold') return false;
      const text = [vehicleDisplayTitle(car), car.make, car.model, car.variant, car.colour, car.transmission, vehicleRegistration(car)].filter(Boolean).join(' ').toLocaleLowerCase();
      return words.every(word => text.includes(word) || text.replace(/\s/g, '').includes(word));
    });
  }, [cars, query]);
  const choose = (car: Car) => {
    if (car.id === currentId) { onOpenChange(false); return; }
    if (purpose === 'enquiry' && readEnquiryDraft(enquiryDraftKey(car.id, 'general'))) { setSavedCar(car); return; }
    onSelect(car, true);
  };
  const clearQuery = () => {
    setQuery('');
    search.current?.focus({ preventScroll: true });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="enquiry-car-picker" onCloseAutoFocus={event => {
      if (returnFocus?.current?.isConnected) {
        event.preventDefault();
        returnFocus.current.focus({ preventScroll: true });
      }
    }}>
      <DialogHeader>
        <DialogTitle ref={savedTitle}>{savedCar ? 'You have an enquiry for this car' : 'Choose a car'}</DialogTitle>
        <DialogDescription>{savedCar ? 'Open your saved enquiry for this car. The enquiry you are working on now will also be kept.' : purpose === 'part-exchange' ? 'Choose the car you’d like to part exchange yours for.' : 'Your message and contact details will stay with you.'}</DialogDescription>
      </DialogHeader>
      {savedCar ? <div className="enquiry-car-picker__saved">
        <p className="font-semibold">{vehicleDisplayTitle(savedCar)}</p>
        <p className="text-sm text-muted-foreground">{readEnquiryDraft(enquiryDraftKey(savedCar.id, 'general'))?.message || 'An unfinished enquiry is saved for this car.'}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => onSelect(savedCar, false)}>Open saved enquiry</Button>
          <Button type="button" variant="outline" onClick={() => {
            returnToSearch.current = true;
            setSavedCar(null);
          }}>Choose another car</Button>
        </div>
      </div> : <>
        <div className="enquiry-car-picker__search">
          <Search size={19} aria-hidden="true" />
          <input ref={search} type="search" aria-label="Search available cars" value={query} maxLength={120} placeholder="Make, model or registration" onChange={event => setQuery(event.target.value)} />
          {query && <button type="button" className="enquiry-car-picker__clear" aria-label="Clear car search" onClick={clearQuery}><X size={17} aria-hidden="true" /></button>}
        </div>
        <p className="enquiry-car-picker__count" role="status">{choices.length} {choices.length === 1 ? 'car' : 'cars'}</p>
        <div className="enquiry-car-picker__results" aria-label="Available cars">
          {choices.map(car => {
            const plate = vehicleRegistration(car);
            const registration = plate ? formatRegistrationPlate(plate) : null;
            return <button type="button" className="enquiry-car-picker__car" key={car.id} aria-label={`Choose ${vehicleDisplayTitle(car)}${registration ? `, ${registration}` : ''}`} aria-current={car.id === currentId ? 'true' : undefined} onClick={() => choose(car)}>
              <CarPhoto car={car} />
              <span className="enquiry-car-picker__details">
                <span className="enquiry-car-picker__name"><MakeLogo make={car.make} size={20} />{vehicleDisplayTitle(car)}</span>
                <span className="enquiry-car-picker__meta">{[car.year, registration, car.mileage != null ? formatMileage(car.mileage) : null, car.transmission].filter(Boolean).join(' · ')}</span>
                <span className="enquiry-car-picker__price">{car.price != null ? formatPrice(car.price, car.currency) : 'Ask for price'}{car.inventoryStatus === 'reserved' && <span>Reserved</span>}</span>
              </span>
              {car.id === currentId && <Check className="enquiry-car-picker__selected" size={20} aria-hidden="true" />}
            </button>;
          })}
          {!choices.length && <div className="enquiry-car-picker__empty"><p>No cars match that search.</p><button type="button" className="min-h-11 underline underline-offset-4" onClick={clearQuery}>Show all cars</button></div>}
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
