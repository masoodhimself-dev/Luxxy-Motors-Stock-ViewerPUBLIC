import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, ChevronDown, ChevronUp, Scale, X } from 'lucide-react';
import { useStock } from '@/lib/stock-context';
import { MAX_COMPARE, useSavedCars } from '@/lib/saved-cars-context';
import { getSafeImageUrl, getThumbnailUrl } from '@/lib/utils';
import { vehicleLabelFor } from '@/components/saved-car-controls';
import { trackEvent } from '@/lib/analytics';

export function routeAllowsCompareTray(location: string) {
  return location !== '/compare' && !location.startsWith('/vehicle/');
}

export function CompareTray() {
  const [location] = useLocation();
  const { stock, isLoading } = useStock();
  const { compareIds, removeFromCompare, clearCompare, pruneCompare } = useSavedCars();
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const previousIds = useRef(compareIds);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (isLoading || !stock?.cars.length) return;
    pruneCompare(stock.cars.map((car) => car.id));
  }, [isLoading, stock, pruneCompare]);

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

  if (!routeAllowsCompareTray(location) || cars.length === 0 || dismissed) return null;

  const readyToCompare = cars.length === MAX_COMPARE;

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t-4 border-primary bg-background shadow-[0_-8px_0px_hsl(var(--primary))]"
        role="region"
        aria-label="Cars selected for comparison"
        data-testid="compare-tray"
      >
        <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
        <div className="container mx-auto flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-6 lg:px-8">
          <div className="flex min-h-12 items-center justify-between sm:hidden">
            <p className="font-display text-[12px] font-black uppercase tracking-[0.2em] text-primary">{cars.length} of {MAX_COMPARE} selected</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? 'Expand comparison tray' : 'Collapse comparison tray'} className="grid h-12 w-12 place-items-center border-2 border-primary bg-primary/5 shadow-[2px_2px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground">
                {collapsed ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
              </button>
              <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss comparison tray" className="grid h-12 w-12 place-items-center border-2 border-primary bg-primary/5 shadow-[2px_2px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <p className="font-display text-[11px] font-black uppercase tracking-[0.2em] hidden shrink-0 text-primary/60 lg:block">COMPARING</p>

          <ul className={`${collapsed ? 'hidden sm:flex' : 'flex'} flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-4 sm:gap-3`}>
            {cars.map((car) => {
              const thumbnail = getThumbnailUrl(car) || (car.images?.[0] ? getSafeImageUrl(car.images[0]) : '');
              return (
                <li
                  key={car.id}
                  className="flex min-w-0 flex-1 items-center gap-3 border-2 border-primary bg-primary/5 p-2 sm:flex-none sm:w-64 shadow-[2px_2px_0px_hsl(var(--primary))]"
                >
                  <Link href={`/vehicle/${car.id}`} className="flex min-w-0 flex-1 items-center gap-3 focus-visible:ring-0 group">
                    {thumbnail ? (
                      <img src={thumbnail} alt="" referrerPolicy="no-referrer" className="h-12 w-16 shrink-0 object-cover border-2 border-primary/20" />
                    ) : (
                      <span className="h-12 w-16 shrink-0 bg-primary/10 border-2 border-primary/20" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-widest text-primary group-hover:text-accent transition-colors">{vehicleLabelFor(car)}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeFromCompare(car.id)}
                    aria-label={`Remove ${vehicleLabelFor(car)} from your comparison`}
                    className="shrink-0 grid h-8 w-8 place-items-center text-primary/50 transition-colors hover:text-destructive focus-visible:outline-none"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}

            {!readyToCompare && (
              <li className="hidden flex-1 items-center gap-3 border-2 border-dashed border-primary/20 bg-background px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-primary/40 sm:flex sm:w-64 sm:flex-none">
                <Scale className="h-4 w-4 shrink-0 text-accent/50" />
                Pick one more car
              </li>
            )}
          </ul>

          <div className={`${collapsed ? 'hidden sm:flex' : 'flex'} shrink-0 items-center justify-between sm:justify-start gap-4`}>
            <button
              type="button"
              onClick={clearCompare}
              className="font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary/60 transition-colors hover:text-destructive focus-visible:outline-none"
            >
              CLEAR
            </button>
            {readyToCompare ? (
              <Link
                href="/compare"
                onClick={() => trackEvent('comparison_opened', { source: 'compare_tray', vehicle_count: cars.length })}
                data-testid="link-open-compare"
                className="inline-flex h-12 sm:h-14 items-center gap-3 bg-primary px-6 font-display text-[12px] font-black uppercase tracking-[0.2em] text-primary-foreground shadow-[4px_4px_0px_hsl(var(--accent))] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--accent))] focus-visible:outline-none"
              >
                COMPARE {MAX_COMPARE}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="inline-flex h-12 items-center text-[11px] font-bold uppercase tracking-widest text-primary/50 sm:hidden">
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