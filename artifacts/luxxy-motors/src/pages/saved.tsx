import { PageHeading, PageEmptyState } from '@/components/page-ui';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Heart, Trash2 } from 'lucide-react';
import { useStock, type Car } from '@/lib/stock-context';
import { useSavedCars } from '@/lib/saved-cars-context';
import { CarCard } from '@/components/car-card';
import { Button } from '@/components/ui/button';

export default function Saved() {
  const { stock, isLoading, error } = useStock();
  const { savedIds, clearSaved } = useSavedCars();

  const cars = savedIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is Car => Boolean(car));

  const unavailableIds = !isLoading && stock ? savedIds.filter((id) => !stock.cars.some((car) => car.id === id)) : [];

  if (isLoading && savedIds.length > 0) {
    return (
      <div className="container mx-auto px-4 py-16 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading saved cars">
        <div className="h-4 w-40 animate-pulse bg-primary/20 border border-primary" />
        <div className="mt-8 h-16 w-80 max-w-full animate-pulse bg-primary/20 border border-primary" />
        <div className="mt-12 space-y-8">
          <div className="h-64 animate-pulse bg-primary/10 border border-primary shadow-none" />
          <div className="h-64 animate-pulse bg-primary/10 border border-primary shadow-none" />
        </div>
      </div>
    );
  }

  return (
    <div className="luxxy-shell min-h-screen bg-background pb-24 pt-8 md:pt-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-3 font-display text-[12px] font-normal text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to showroom
        </Link>

        <div className="mt-6">
          <PageHeading eyebrow="Your shortlist" title="Saved cars" description="Kept on this device. Pick up where you left off and compare your favourites." action={savedIds.length > 0 && <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground" data-testid="text-saved-count">{cars.length} {cars.length === 1 ? 'car' : 'cars'} saved</p>
            <Button variant="outline" onClick={() => clearSaved()} data-testid="button-clear-saved"><Trash2 className="h-4 w-4" /> Clear all</Button>
          </div>} />
        </div>

        {unavailableIds.length > 0 && (
          <div className="mt-8 flex flex-col gap-4 border border-border bg-accent/5 px-6 py-4 font-normal text-[12px] leading-relaxed text-primary/80 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {unavailableIds.length === 1 ? 'One saved car is' : `${unavailableIds.length} saved cars are`} no longer in stock.
            </p>
            <button
              type="button"
              onClick={() => clearSaved(unavailableIds)}
              data-testid="button-remove-unavailable"
              className="min-h-11 shrink-0 self-start font-display text-[13px] font-semibold text-accent underline-offset-4 transition-colors hover:text-primary hover:underline sm:self-auto"
            >
              Remove {unavailableIds.length === 1 ? 'it' : 'them'}
            </button>
          </div>
        )}

        {error ? (
          <div role="alert"><PageEmptyState title="Stock could not be loaded" action={<Button onClick={() => window.location.reload()}>Try again</Button>}>
            Your selections are still saved on this device. Try again to check current availability.
          </PageEmptyState></div>
        ) : cars.length > 0 ? (
          <div className="mt-6 flex flex-col gap-6">
            {cars.map((car) => (
              <CarCard key={car.id} car={car} layout="row" />
            ))}
          </div>
        ) : (
          <PageEmptyState title={unavailableIds.length ? 'No saved cars available' : 'No saved cars yet'} action={<Button asChild><Link href="/">Browse stock <ArrowRight className="h-4 w-4" /></Link></Button>}>
            {unavailableIds.length ? 'Your saved vehicles have left our current stock. Browse the showroom to start a new shortlist.' : 'Tap the heart on any car to save it here.'}
          </PageEmptyState>
        )}
      </div>
    </div>
  );
}