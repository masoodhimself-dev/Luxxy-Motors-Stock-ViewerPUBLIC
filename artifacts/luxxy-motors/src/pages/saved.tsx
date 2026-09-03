import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Heart, Trash2 } from 'lucide-react';
import { useStock, type Car } from '@/lib/stock-context';
import { useSavedCars } from '@/lib/saved-cars-context';
import { CarCard } from '@/components/car-card';

export default function Saved() {
  const { stock, isLoading } = useStock();
  const { savedIds, clearSaved } = useSavedCars();

  const cars = savedIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is Car => Boolean(car));

  const unavailableIds = !isLoading && stock ? savedIds.filter((id) => !stock.cars.some((car) => car.id === id)) : [];

  if (isLoading && savedIds.length > 0) {
    return (
      <div className="container mx-auto px-4 py-16 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading saved cars">
        <div className="h-3 w-40 animate-pulse bg-secondary" />
        <div className="mt-6 h-14 w-80 max-w-full animate-pulse bg-secondary" />
        <div className="mt-10 space-y-5">
          <div className="h-56 animate-pulse bg-secondary" />
          <div className="h-56 animate-pulse bg-secondary" />
        </div>
      </div>
    );
  }

  return (
    <div className="luxxy-shell min-h-screen bg-muted/30 pb-24 pt-8 md:pt-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[13px] font-bold text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to showroom
        </Link>

        <div className="mt-6 flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="luxxy-kicker text-accent">
              <Heart className="h-4 w-4" /> Your shortlist
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-none tracking-[-.03em] text-primary md:text-5xl">
              Saved cars
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
              Kept on this device, so you can pick up where you left off. Nothing is shared with us until you get in touch.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
            {cars.length > 0 && (
              <p className="font-mono text-[13px] font-bold text-primary" data-testid="text-saved-count">
                {cars.length} {cars.length === 1 ? 'car' : 'cars'} saved
              </p>
            )}
            {savedIds.length > 0 && (
              <button
                type="button"
                onClick={() => clearSaved()}
                data-testid="button-clear-saved"
                className="inline-flex h-11 items-center justify-center gap-2 border border-border bg-background px-4 text-[13px] font-bold text-foreground transition-colors hover:border-primary/45 hover:bg-secondary"
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </button>
            )}
          </div>
        </div>

        {unavailableIds.length > 0 && (
          <div className="mt-6 flex flex-col gap-3 border border-dashed border-border bg-card px-4 py-3 text-[13px] leading-6 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <p>
              {unavailableIds.length === 1 ? 'One saved car is' : `${unavailableIds.length} saved cars are`} no longer in
              stock.
            </p>
            <button
              type="button"
              onClick={() => clearSaved(unavailableIds)}
              data-testid="button-remove-unavailable"
              className="shrink-0 self-start font-bold text-primary underline-offset-4 transition-colors hover:text-accent hover:underline sm:self-auto"
            >
              Remove {unavailableIds.length === 1 ? 'it' : 'them'}
            </button>
          </div>
        )}

        {cars.length > 0 ? (
          <div className="mt-8 flex flex-col gap-5">
            {cars.map((car) => (
              <CarCard key={car.id} car={car} layout="row" />
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-10 max-w-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
            <span className="mx-auto mb-6 grid h-14 w-14 place-items-center border border-border bg-secondary text-accent">
              <Heart className="h-6 w-6" />
            </span>
            <p className="font-display text-3xl font-semibold tracking-tight text-primary">Nothing saved yet</p>
            <p className="mx-auto mb-8 mt-3 max-w-md text-base leading-7 text-muted-foreground">
              Tap the heart on any car in the showroom and it will be waiting for you here.
            </p>
            <Link
              href="/"
              data-testid="link-saved-browse"
              className="inline-flex h-14 items-center justify-center gap-3 bg-primary px-8 text-base font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Browse the stock list
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
