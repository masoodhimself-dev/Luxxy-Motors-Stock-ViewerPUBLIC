import type { Car } from '@/lib/stock-context';
import { formatPrice } from '@/lib/utils';
import './price-reduction.css';

const PRICE_REDUCTION_LIFETIME = 14 * 86400000;

export function priceReduction(car: Pick<Car, 'price' | 'sourceExtras'> & Partial<Pick<Car, 'currency'>>, now = Date.now()) {
  const value = car.sourceExtras?.websitePriceReduction;
  if (!value || typeof value !== 'object' || Array.isArray(value) || (car.currency && car.currency !== 'GBP')) return null;
  const { previousPrice, currentPrice, detectedAt, expiresAt } = value as Record<string, unknown>;
  const time = typeof detectedAt === 'string' ? Date.parse(detectedAt) : NaN;
  const expiry = expiresAt === undefined ? time + PRICE_REDUCTION_LIFETIME : typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN;
  if (typeof previousPrice !== 'number' || !Number.isFinite(previousPrice) ||
      typeof currentPrice !== 'number' || !Number.isFinite(currentPrice) || currentPrice <= 0 ||
      car.price !== currentPrice || previousPrice <= currentPrice ||
      !Number.isFinite(time) || !Number.isFinite(expiry) || expiry <= time || now < time ||
      now >= Math.min(expiry, time + PRICE_REDUCTION_LIFETIME)) return null;
  return { previousPrice, saving: previousPrice - currentPrice };
}

export function PriceReduction({ car, showRecordedDate = false }: { car: Pick<Car, 'price' | 'currency' | 'sourceExtras'>; showRecordedDate?: boolean }) {
  const reduction = priceReduction(car);
  if (!reduction) return null;
  const detectedAt = (car.sourceExtras!.websitePriceReduction as Record<string, unknown>).detectedAt as string;
  return <div className="price-reduction" data-testid="price-reduction" aria-label="Recorded price reduction">
    <strong className="price-reduction-label">Price reduced</strong>
    <span>Was <s>{formatPrice(reduction.previousPrice, car.currency)}</s></span>
    <span className="price-reduction-saving">Save {formatPrice(reduction.saving, car.currency)}</span>
    {showRecordedDate && <span className="price-reduction-date">Price change recorded <time dateTime={detectedAt}>{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(detectedAt))}</time></span>}
  </div>;
}
