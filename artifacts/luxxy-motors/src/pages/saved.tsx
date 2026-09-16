import { PageHeading } from '@/components/page-ui';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Heart, Trash2 } from 'lucide-react';
import { useStock, type Car } from '@/lib/stock-context';
import { useSavedCars } from '@/lib/saved-cars-context';
import { CarCard } from '@/components/car-card';
import { Button } from '@/components/ui/button';

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

        <div className="mt-8 flex flex-col gap-6 border-b border-primary pb-8 sm:flex-row sm:items-end sm:justify-between">
          <PageHeading eyebrow="Your shortlist" title="Saved cars" description="Kept on this device. Pick up where you left off and compare your favourites." />
          <div className="flex shrink-0 flex-col items-start gap-4 sm:items-end">
            {cars.length > 0 && (
              <p className="font-display font-semibold text-[13px] tracking-normal text-primary bg-primary/5 border border-primary/10 px-3 py-1.5" data-testid="text-saved-count">
                {cars.length} {cars.length === 1 ? 'CAR' : 'CARS'} SAVED
              </p>
            )}
            {savedIds.length > 0 && (
              <Button
                variant="outline"
                onClick={() => clearSaved()}
                data-testid="button-clear-saved"
                className="h-12 border border-border bg-card font-display text-[11px] font-normal text-primary shadow-none transition-all hover:bg-primary hover:text-primary-foreground rounded-md"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Clear all
              </Button>
            )}
          </div>
        </div>

        {unavailableIds.length > 0 && (
          <div className="mt-8 flex flex-col gap-4 border border-dashed border-accent bg-accent/5 px-6 py-4 font-normal text-[12px] leading-relaxed text-primary/80 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {unavailableIds.length === 1 ? 'ONE SAVED CAR IS' : `${unavailableIds.length} SAVED CARS ARE`} NO LONGER IN STOCK.
            </p>
            <button
              type="button"
              onClick={() => clearSaved(unavailableIds)}
              data-testid="button-remove-unavailable"
              className="shrink-0 self-start font-display text-[13px] font-semibold text-accent underline-offset-4 transition-colors hover:text-primary hover:underline sm:self-auto"
            >
              REMOVE {unavailableIds.length === 1 ? 'IT' : 'THEM'}
            </button>
          </div>
        )}

        {cars.length > 0 ? (
          <div className="mt-12 flex flex-col gap-8">
            {cars.map((car) => (
              <CarCard key={car.id} car={car} layout="row" />
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-10 max-w-2xl border border-dashed border-primary/20 bg-primary/5 px-6 py-12 text-center">
            <span className="mx-auto mb-6 grid h-16 w-16 place-items-center border border-border bg-card text-accent shadow-none">
              <Heart className="h-8 w-8" />
            </span>
            <p className="font-display text-2xl font-semibold tracking-tight text-primary">Nothing Saved Yet</p>
            <p className="mx-auto mb-10 mt-4 max-w-md font-normal text-sm leading-relaxed text-muted-foreground">
              Tap the heart on any car in the showroom and it will be waiting for you here.
            </p>
            <Button asChild size="lg" className="min-h-12 rounded-md bg-primary font-display text-[13px] font-normal text-primary-foreground shadow-none transition-all hover:bg-accent active:shadow-none">
              <Link href="/">Browse Stock <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}