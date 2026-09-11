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
        <div className="h-4 w-40 animate-pulse bg-primary/20 border-2 border-primary" />
        <div className="mt-8 h-16 w-80 max-w-full animate-pulse bg-primary/20 border-2 border-primary" />
        <div className="mt-12 space-y-8">
          <div className="h-64 animate-pulse bg-primary/10 border-4 border-primary shadow-[8px_8px_0px_hsl(var(--primary))]" />
          <div className="h-64 animate-pulse bg-primary/10 border-4 border-primary shadow-[8px_8px_0px_hsl(var(--primary))]" />
        </div>
      </div>
    );
  }

  return (
    <div className="luxxy-shell min-h-screen bg-background pb-24 pt-8 md:pt-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-3 font-display text-[12px] font-bold uppercase tracking-[0.2em] text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to showroom
        </Link>

        <div className="mt-8 flex flex-col gap-6 border-b-4 border-primary pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[12px] font-black uppercase tracking-[0.2em] text-accent flex items-center gap-2 mb-4">
              <Heart className="h-4 w-4" /> Your shortlist
            </p>
            <h1 className="heading-1 text-primary">Saved Cars</h1>
            <p className="mt-4 max-w-lg font-bold uppercase tracking-widest text-sm text-primary/80 leading-relaxed border-l-4 border-accent pl-4">
              Kept on this device, so you can pick up where you left off. Nothing is shared with us until you get in touch.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-4 sm:items-end">
            {cars.length > 0 && (
              <p className="font-display font-black text-[13px] uppercase tracking-widest text-primary bg-primary/5 border-2 border-primary/10 px-3 py-1.5" data-testid="text-saved-count">
                {cars.length} {cars.length === 1 ? 'CAR' : 'CARS'} SAVED
              </p>
            )}
            {savedIds.length > 0 && (
              <Button
                variant="outline"
                onClick={() => clearSaved()}
                data-testid="button-clear-saved"
                className="h-12 border-2 border-primary bg-background font-display text-[11px] font-bold uppercase tracking-widest text-primary shadow-[3px_3px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[0px_0px_0px_hsl(var(--primary))] rounded-none"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Clear all
              </Button>
            )}
          </div>
        </div>

        {unavailableIds.length > 0 && (
          <div className="mt-8 flex flex-col gap-4 border-4 border-dashed border-accent bg-accent/5 px-6 py-4 font-bold uppercase tracking-widest text-[12px] leading-relaxed text-primary/80 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {unavailableIds.length === 1 ? 'ONE SAVED CAR IS' : `${unavailableIds.length} SAVED CARS ARE`} NO LONGER IN STOCK.
            </p>
            <button
              type="button"
              onClick={() => clearSaved(unavailableIds)}
              data-testid="button-remove-unavailable"
              className="shrink-0 self-start font-display text-[13px] font-black text-accent underline-offset-4 transition-colors hover:text-primary hover:underline sm:self-auto"
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
          <div className="mx-auto mt-16 max-w-2xl border-4 border-dashed border-primary/20 bg-primary/5 px-6 py-24 text-center">
            <span className="mx-auto mb-6 grid h-16 w-16 place-items-center border-4 border-primary bg-background text-accent shadow-[4px_4px_0px_hsl(var(--primary))]">
              <Heart className="h-8 w-8" />
            </span>
            <p className="font-display text-4xl font-black uppercase tracking-tight text-primary">Nothing Saved Yet</p>
            <p className="mx-auto mb-10 mt-4 max-w-md font-bold uppercase tracking-widest text-sm leading-relaxed text-primary/60">
              Tap the heart on any car in the showroom and it will be waiting for you here.
            </p>
            <Button asChild size="lg" className="h-16 rounded-none bg-primary font-display text-[13px] font-bold uppercase tracking-[0.15em] text-primary-foreground shadow-[4px_4px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_hsl(var(--accent))] active:shadow-none">
              <Link href="/">Browse Stock <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}