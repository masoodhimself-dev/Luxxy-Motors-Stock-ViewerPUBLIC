import { useDealerSettings } from '@/lib/dealer-settings-context';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, ChevronDown, ChevronUp, Scale, X } from 'lucide-react';
import { useStock } from '@/lib/stock-context';
import { MAX_COMPARE, useSavedCars } from '@/lib/saved-cars-context';
import { getSafeImageUrl, getThumbnailUrl, vehicleRegistration } from '@/lib/utils';
import { vehicleLabelFor } from '@/components/saved-car-controls';
import { trackEvent } from '@/lib/analytics';

export function routeAllowsCompareTray(location: string) {
  return ['/', '/saved'].includes(location);
}

export function CompareTray() {
  const { settings } = useDealerSettings();
  const [location] = useLocation();
  const { stock, isLoading, error } = useStock();
  const { compareIds, removeFromCompare, clearCompare, pruneCompare } = useSavedCars();
  const [collapsed, setCollapsed] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  const previousIds = useRef(compareIds);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (isLoading || error || !stock) return;
    pruneCompare(stock.cars.filter(car => !['sold', 'hidden', 'archived'].includes(String(car.inventoryStatus))).map((car) => car.id));
  }, [isLoading, error, stock, pruneCompare]);

  useEffect(() => {
    const before = previousIds.current;
    const added = compareIds.find((id) => !before.includes(id));
    const removed = before.find((id) => !compareIds.includes(id));
    if (added) setAnnouncement('Vehicle added to comparison.');
    if (removed) setAnnouncement('Vehicle removed from comparison.');
    if (added) setDismissed(false);
    previousIds.current = compareIds;
  }, [compareIds]);

  const cars = compareIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is NonNullable<typeof car> => Boolean(car));

  if (!settings.presentation?.comparisonEnabled || !routeAllowsCompareTray(location) || cars.length === 0 || dismissed) return null;

  const readyToCompare = cars.length === MAX_COMPARE;

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card shadow-none"
        role="region"
        aria-label="Cars selected for comparison"
        data-testid="compare-tray"
      >
        <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
        <div className="container mx-auto flex flex-col gap-3 px-4 py-2 sm:py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6 lg:px-8">
          <div className="flex min-h-12 items-center justify-between sm:hidden">
            <p className="font-display text-[12px] font-semibold tracking-normal text-primary">{cars.length} of {MAX_COMPARE} selected</p>
            <div className="flex items-center gap-1">
              {readyToCompare && <Link href="/compare" className="text-link px-2 text-sm" onClick={() => trackEvent('comparison_opened', { source: 'compare_tray', vehicle_count: cars.length })}>Compare <ArrowRight className="h-4 w-4" /></Link>}
              <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand comparison tray' : 'Collapse comparison tray'} className="grid h-12 w-12 place-items-center border border-primary bg-primary/5 shadow-none transition-all hover:bg-primary hover:text-primary-foreground">
                {collapsed ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </button>
              <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss comparison tray" className="grid h-12 w-12 place-items-center border border-primary bg-primary/5 shadow-none transition-all hover:bg-primary hover:text-primary-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <p className="font-display text-[11px] font-semibold tracking-normal hidden shrink-0 text-primary/60 lg:block">COMPARING</p>

          <ul className={`${collapsed ? 'hidden sm:flex' : 'flex'} flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-4 sm:gap-3`}>
            {cars.map((car) => {
              const thumbnail = getThumbnailUrl(car) || (car.images?.[0] ? getSafeImageUrl(car.images[0]) : '');
              return (
                <li
                  key={car.id}
                  className="flex min-w-0 flex-1 items-center gap-3 border border-primary bg-primary/5 p-2 sm:flex-none sm:w-52 shadow-none"
                >
                  <Link href={`/vehicle/${car.id}`} className="flex min-w-0 flex-1 items-center gap-3 group">
                    {thumbnail ? (
                      <img src={thumbnail} alt="" referrerPolicy="no-referrer" className="h-12 w-16 shrink-0 object-cover border border-primary/20" />
                    ) : (
                      <span className="h-12 w-16 shrink-0 bg-primary/10 border border-primary/20" />
                    )}
                    <span className="min-w-0 flex-1 text-primary group-hover:text-accent transition-colors"><span className="block truncate text-[11px] font-bold tracking-normal">{vehicleLabelFor(car)}</span>{vehicleRegistration(car) && <span className="block truncate text-[11px] text-muted-foreground">{vehicleRegistration(car)}</span>}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeFromCompare(car.id)}
                    aria-label={`Remove ${vehicleLabelFor(car)} from your comparison`}
                    className="shrink-0 grid h-11 w-11 place-items-center text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}

            {!readyToCompare && (
              <li className="hidden flex-1 items-center gap-3 border border-dashed border-primary/20 bg-background px-4 py-3 text-[11px] font-bold tracking-normal text-muted-foreground sm:flex sm:w-52 sm:flex-none">
                <Scale className="h-4 w-4 shrink-0 text-accent/50" />
                Pick one more car
              </li>
            )}
          </ul>

          <div className={`${collapsed ? 'hidden sm:flex' : 'flex'} shrink-0 items-center justify-between sm:justify-start gap-4`}>
            <button
              type="button"
              onClick={clearCompare}
              className="font-display text-[11px] font-semibold tracking-normal text-primary/60 transition-colors hover:text-destructive"
            >
              CLEAR
            </button>
            {readyToCompare ? (
              <Link
                href="/compare"
                onClick={() => trackEvent('comparison_opened', { source: 'compare_tray', vehicle_count: cars.length })}
                data-testid="link-open-compare"
                className="inline-flex h-12 sm:h-12 items-center gap-3 bg-primary px-6 font-display text-[12px] font-semibold tracking-normal text-primary-foreground shadow-none transition-all"
              >
                COMPARE {MAX_COMPARE}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="inline-flex h-12 items-center text-[11px] font-bold tracking-normal text-muted-foreground sm:hidden">
                Pick one more car
              </span>
            )}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="h-[7.5rem] bg-background sm:h-[6.5rem]" />
    </>
  );
}
