import { readSavedSnapshots, savedPriceReduction } from '@/lib/saved-car-snapshots';
import { formatPrice } from '@/lib/utils';
import { ShowroomPhoto } from '@/components/showroom-photo';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { customerDefaultCopy, websiteText } from "@/lib/website-content";
import { useSearch } from "wouter";
import { parseShortlist } from "@/lib/customer-convenience";
import { PageHeading, PageEmptyState } from "@/components/page-ui";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight } from "@/components/icons";
import { useStock, type Car } from "@/lib/stock-context";
import { useSavedCars } from "@/lib/saved-cars-context";
import { CarCard } from "@/components/car-card";
import { Button } from "@/components/ui/button";
import { CarComparison } from '@/components/car-comparison';
import { CarComparisonTray, useComparisonSelection, useShortlistShare } from '@/components/car-comparison-tray';
import { MAX_COMPARISON_CARS } from '@/lib/car-comparison';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import './customer-workflows.css';
import './saved-car-layout.css';

export default function Saved() {
  const { settings } = useDealerSettings();
  const { stock, isLoading, error } = useStock();
  const { savedIds, clearSaved } = useSavedCars();

  const sharedIds = parseShortlist(useSearch());
  usePageMeta({
    title: `${sharedIds ? 'Shared shortlist' : 'Saved cars'} | ${settings.identity.name}`,
    description: 'Review your shortlisted cars, explore their details and arrange a test drive.',
  });
  const shownIds = sharedIds ?? savedIds;
  const snapshots = readSavedSnapshots();
  const { share, shareStatus, copyLink, reset: resetShare } = useShortlistShare();
  const cars = shownIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is Car => Boolean(car) && !['sold', 'archived', 'hidden'].includes(String(car?.inventoryStatus)));
  const comparison = useComparisonSelection(cars);
  const { selectedIds, comparedCars } = comparison;
  function openComparison() {
    resetShare();
    comparison.setOpen(true);
  }

  const unavailableIds =
    !isLoading && stock
      ? shownIds.filter((id) => !stock.cars.some((car) => car.id === id && !['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus))))
      : [];

  if (isLoading && shownIds.length > 0) {
    return (
      <div
        className="container mx-auto px-4 py-16 sm:px-6 lg:px-8"
        aria-busy="true"
        aria-label="Loading saved cars"
      >
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
    <div className="friendly-page friendly-saved luxxy-shell min-h-screen bg-background pb-24 pt-5 md:pt-8">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/stock"
          className="inline-flex items-center gap-3 font-display text-[12px] font-normal text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to stock
        </Link>

        <div className="friendly-shortlist-intro">
          <PageHeading
            eyebrow={sharedIds ? undefined : customerDefaultCopy(websiteText(settings, "savedEyebrow"), "", ["Your shortlist"])}
            title={sharedIds ? "Shared shortlist" : websiteText(settings, "savedTitle")}
            description={
              sharedIds
                ? "Cars shared with you."
                : customerDefaultCopy(websiteText(settings, "savedDescription"), "Saved on this device.", ["Kept on this device. Pick up where you left off with your favourites."])
            }
          />
        </div>

        {error ? (
          <div role="alert">
            <PageEmptyState
              title="Stock could not be loaded"
              action={
                <Button onClick={() => window.location.reload()}>
                  Try again
                </Button>
              }
            >
              Your selections are still saved on this device. Try again to check
              current availability.
            </PageEmptyState>
          </div>
        ) : cars.length > 0 ? (
          <div className="saved-car-list flex flex-col gap-6">
            {cars.map((car) => {
              const reduction = savedPriceReduction(snapshots[car.id], car);
              const reserved = car.inventoryStatus === 'reserved';
              return <div key={car.id} className="overflow-hidden rounded-md border border-border bg-card">
                {!sharedIds && (reduction != null || reserved) && <div className="flex flex-wrap gap-2 px-4 pt-4 text-sm" aria-label="Saved car updates">
                  {reduction != null && <p className="rounded bg-secondary px-3 py-2 font-medium">Price reduced by {formatPrice(reduction, car.currency)} since you saved it</p>}
                  {reserved && <p className="rounded bg-secondary px-3 py-2">{snapshots[car.id]?.status === 'available' ? 'Reserved since you saved it' : 'Currently reserved'}</p>}
                </div>}
                <CarCard car={car} layout="compact" catalogue savedDetails analyticsSource="saved_cars"
                  compareAction={cars.length >= 2 ? {
                    selected: selectedIds.includes(car.id),
                    disabled: !selectedIds.includes(car.id) && selectedIds.length === MAX_COMPARISON_CARS,
                    onToggle: () => comparison.toggle(car.id),
                  } : undefined}
                />
              </div>;
            })}
          </div>
        ) : (
          <PageEmptyState
            title={
              sharedIds
                ? "No cars available in this shortlist"
                : unavailableIds.length
                  ? "No saved cars available"
                  : "No saved cars yet"
            }
            action={
              <Button asChild>
                <Link href="/stock">
                  Browse stock <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            }
          >
            {sharedIds
              ? "These cars are no longer in our current stock. Browse our available cars to start a new shortlist."
              : unavailableIds.length
                ? "Your saved cars are no longer in our current stock. Browse our available cars to start a new shortlist."
                : "Choose Save on a car to add it here."}
          </PageEmptyState>
        )}
        {shownIds.length > 0 && (
          <div className="saved-car-tools">
            <p
              className="text-sm text-muted-foreground"
              data-testid="text-saved-count"
            >
              {cars.length} {cars.length === 1 ? "car" : "cars"}{" "}
              {sharedIds ? "in this shortlist" : "saved"}
            </p>
            <Button variant="outline" onClick={() => void share(shownIds)}>
              {shownIds.length > 12
                ? "Share first 12 cars"
                : "Share shortlist"}
            </Button>
            {!sharedIds && (
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="ghost" data-testid="button-clear-saved" className="text-muted-foreground">Clear all</Button></AlertDialogTrigger>
                <AlertDialogContent className="max-w-[calc(100vw-32px)] rounded-xl sm:max-w-md">
                  <AlertDialogHeader><AlertDialogTitle>Clear your saved cars?</AlertDialogTitle><AlertDialogDescription>This removes your shortlist from this device. You can save cars again whenever you like.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Keep my cars</AlertDialogCancel><AlertDialogAction onClick={() => clearSaved()}>Clear saved cars</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
        {shareStatus && (
          <p role="status" className="mt-3 text-sm">
            {shareStatus}
          </p>
        )}
        {copyLink && (
          <label className="mt-3 block text-sm">
            Shortlist link
            <input
              readOnly
              value={copyLink}
              onFocus={(event) => event.target.select()}
              className="mt-2 min-h-11 w-full border border-border px-3"
            />
          </label>
        )}
        {sharedIds && (
          <Link href="/saved" className="text-link min-h-11">
            View my saved cars
          </Link>
        )}
        {!error && unavailableIds.length > 0 && (
          <div className="mt-8 flex flex-col gap-4 border border-border bg-accent/5 px-6 py-4 font-normal text-[12px] leading-relaxed text-primary/80 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {unavailableIds.length === 1
                ? "One saved car is"
                : `${unavailableIds.length} saved cars are`}{" "}
              no longer in stock.
            </p>
            {!sharedIds && (
              <button
                type="button"
                onClick={() => clearSaved(unavailableIds)}
                data-testid="button-remove-unavailable"
                className="min-h-11 shrink-0 self-start font-display text-[13px] font-semibold text-accent underline-offset-4 transition-colors hover:text-primary hover:underline sm:self-auto"
              >
                Remove {unavailableIds.length === 1 ? "it" : "them"}
              </button>
            )}
          </div>
        )}

        {!error && !sharedIds && unavailableIds.length > 0 && <div className="mt-4 grid gap-4 sm:grid-cols-2">{unavailableIds.map(id => <article key={id} className="flex items-start gap-4 rounded-md border border-border bg-card p-4">{snapshots[id]?.photo && <ShowroomPhoto src={snapshots[id].photo} alt="" className="aspect-[4/3] w-24 shrink-0" fit="contain" />}<div className="min-w-0"><h2 className="font-semibold">{snapshots[id]?.title || 'Previously saved car'}</h2>{snapshots[id]?.registration && <p className="mt-1 text-xs text-muted-foreground">{snapshots[id].registration}</p>}<p className="mt-1 text-sm text-muted-foreground">No longer available in current stock.</p><Link href="/stock" className="text-link min-h-11 text-sm">Browse alternatives</Link><button onClick={() => clearSaved([id])} className="ml-4 min-h-11 text-sm underline">Remove</button></div></article>)}</div>}
        {!error && <CarComparisonTray cars={comparedCars} onRemove={comparison.toggle}
          onClear={comparison.clear} onCompare={openComparison} />}
        <CarComparison cars={comparedCars} open={comparison.open && comparedCars.length >= 2 && !error} onOpenChange={comparison.setOpen} onShare={ids => void share(ids)} shareStatus={shareStatus} copyLink={copyLink} returnSource="saved" />
      </div>
    </div>
  );
}
