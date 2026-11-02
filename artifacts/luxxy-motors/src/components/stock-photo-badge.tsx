import { useEffect, useState } from 'react';
import type { Car } from '@/lib/stock-context';
import { arrivalTime, isJustArrived, STOCK_ARRIVAL_LIFETIME } from '@/lib/stock-presentation';
import { formatPrice } from '@/lib/utils';
import { priceReduction } from './price-reduction';
import './stock-photo-badge.css';

type PhotoBadge = { kind: 'new-arrival'; expiresAt: number }
  | { kind: 'price-drop'; saving: number; expiresAt: number };

/** One timely, recorded stock update per photograph. A reduction takes priority. */
export function stockPhotoBadge(car: Car, now = Date.now()): PhotoBadge | null {
  if (car.inventoryStatus && car.inventoryStatus !== 'available') return null;
  const reduction = priceReduction(car, now);
  if (reduction && Number.isSafeInteger(reduction.saving)) {
    // priceReduction has already validated these dates and the current price.
    const evidence = car.sourceExtras!.websitePriceReduction as Record<string, string>;
    const deadline = Date.parse(evidence.detectedAt) + STOCK_ARRIVAL_LIFETIME;
    return {
      kind: 'price-drop', saving: reduction.saving,
      expiresAt: evidence.expiresAt ? Math.min(Date.parse(evidence.expiresAt), deadline) : deadline,
    };
  }
  if (!isJustArrived(car, new Date(now))) return null;
  return { kind: 'new-arrival', expiresAt: arrivalTime(car)! + STOCK_ARRIVAL_LIFETIME };
}

export function StockPhotoBadge({ car }: { car: Car }) {
  const [now, setNow] = useState(Date.now);
  const badge = stockPhotoBadge(car, now);
  const expiresAt = badge?.expiresAt;
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    const timer = expiresAt === undefined ? undefined
      : window.setTimeout(update, Math.max(1, expiresAt - Date.now()));
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [car, expiresAt]);
  if (!badge) return null;
  return <span className={`stock-photo-badge stock-photo-badge-${badge.kind}`} data-testid="stock-photo-badge">
    {badge.kind === 'price-drop'
      ? <><span>Price drop</span><strong>-{formatPrice(badge.saving, car.currency)}</strong></>
      : 'New arrival'}
  </span>;
}
