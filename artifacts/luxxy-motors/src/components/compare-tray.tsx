import { useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Scale, X } from 'lucide-react';
import { useStock } from '@/lib/stock-context';
import { MAX_COMPARE, useSavedCars } from '@/lib/saved-cars-context';
import { getSafeImageUrl, getThumbnailUrl } from '@/lib/utils';
import { vehicleLabelFor } from '@/components/saved-car-controls';

export function CompareTray() {
  const [location] = useLocation();
  const { stock, isLoading } = useStock();
  const { compareIds, removeFromCompare, clearCompare, pruneCompare } = useSavedCars();

  // The tray is mounted on every page, so it is where a comparison left over from an earlier
  // visit gets reconciled: a car that has since sold must give its slot back.
  useEffect(() => {
    // An empty list is more likely a bad response than a sold-out forecourt, so leave the
    // selection alone rather than wiping it.
    if (isLoading || !stock?.cars.length) return;
    pruneCompare(stock.cars.map((car) => car.id));
  }, [isLoading, stock, pruneCompare]);

  const cars = compareIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is NonNullable<typeof car> => Boolean(car));

  if (location === '/compare' || cars.length === 0) return null;

  const readyToCompare = cars.length === MAX_COMPARE;

  return (
    <>
      <div
        className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-accent bg-primary text-primary-foreground shadow-[0_-12px_40px_hsl(var(--primary)/.25)]"
        role="region"
        aria-label="Cars selected for comparison"
        data-testid="compare-tray"
      >
        <div className="container mx-auto flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:gap-6 sm:px-6 lg:px-8">
          <p className="luxxy-label hidden shrink-0 text-primary-foreground/65 lg:block">Comparing</p>

          <ul className="flex flex-1 items-center gap-3">
            {cars.map((car) => {
              const thumbnail = getThumbnailUrl(car) || (car.images?.[0] ? getSafeImageUrl(car.images[0]) : '');
              return (
                <li
                  key={car.id}
                  className="flex min-w-0 flex-1 items-center gap-3 border border-primary-foreground/15 bg-primary-foreground/5 p-1.5 sm:flex-none sm:w-56"
                >
                  {thumbnail ? (
                    <img src={thumbnail} alt="" referrerPolicy="no-referrer" className="h-10 w-14 shrink-0 object-cover" />
                  ) : (
                    <span className="h-10 w-14 shrink-0 bg-primary-foreground/10" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{vehicleLabelFor(car)}</span>
                  <button
                    type="button"
                    onClick={() => removeFromCompare(car.id)}
                    aria-label={`Remove ${vehicleLabelFor(car)} from your comparison`}
                    className="shrink-0 p-1 text-primary-foreground/60 transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              );
            })}

            {!readyToCompare && (
              <li className="hidden flex-1 items-center gap-2 border border-dashed border-primary-foreground/25 px-3 py-3 text-[12px] font-semibold text-primary-foreground/55 sm:flex sm:w-56 sm:flex-none">
                <Scale className="h-4 w-4 shrink-0 text-accent" />
                Pick one more car
              </li>
            )}
          </ul>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={clearCompare}
              className="px-3 py-2 text-[12px] font-bold uppercase tracking-[.08em] text-primary-foreground/60 transition-colors hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Clear
            </button>
            {readyToCompare ? (
              <Link
                href="/compare"
                data-testid="link-open-compare"
                className="inline-flex h-11 items-center gap-3 bg-accent px-5 text-[13px] font-bold text-accent-foreground transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-primary"
              >
                Compare these {MAX_COMPARE}
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className="inline-flex h-11 items-center px-1 text-[12px] font-semibold text-primary-foreground/55 sm:hidden">
                Pick one more car
              </span>
            )}
          </div>
        </div>
      </div>
      {/* Keeps the footer clear of the fixed tray. */}
      <div aria-hidden="true" className="h-[5.5rem] bg-primary sm:h-[4.75rem]" />
    </>
  );
}
