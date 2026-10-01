import type { Car } from '@/lib/stock-context';
import { formatPrice } from '@/lib/utils';

export function priceReduction(car: Pick<Car, 'price' | 'sourceExtras'>, now = Date.now()) {
  const value = car.sourceExtras?.websitePriceReduction;
  if (!value || typeof value !== 'object') return null;
  const { previousPrice, currentPrice, detectedAt } = value as Record<string, unknown>;
  const time = typeof detectedAt === 'string' ? Date.parse(detectedAt) : NaN;
  if (typeof previousPrice !== 'number' || !Number.isFinite(previousPrice) ||
      typeof currentPrice !== 'number' || !Number.isFinite(currentPrice) || currentPrice <= 0 ||
      car.price !== currentPrice || previousPrice <= currentPrice ||
      !Number.isFinite(time) || now < time || now >= time + 14 * 86400000) return null;
  return { previousPrice, saving: previousPrice - currentPrice };
}

export function PriceReduction({ car }: { car: Car }) {
  const reduction = priceReduction(car);
  if (!reduction) return null;
  return <div className="basis-full text-xs leading-6 text-muted-foreground" data-testid="price-reduction">
    <span className="mr-2 font-semibold text-primary">Price reduced</span>
    <span className="sr-only">Previously </span><s>{formatPrice(reduction.previousPrice, car.currency)}</s>
    <span> · Save {formatPrice(reduction.saving, car.currency)}</span>
  </div>;
}
