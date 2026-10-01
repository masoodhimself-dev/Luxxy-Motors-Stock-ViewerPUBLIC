import { SavedCarDetails } from '@/components/saved-car-details';
import { usePageMeta } from '@/hooks/use-page-meta';
import { useDealerSettings } from "@/lib/dealer-settings-context";
import { websiteText } from "@/lib/website-content";
import { useState } from "react";
import { useSearch } from "wouter";
import { parseShortlist, shortlistUrl } from "@/lib/customer-convenience";
import { PageHeading, PageEmptyState } from "@/components/page-ui";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Heart, Trash2 } from "lucide-react";
import { useStock, type Car } from "@/lib/stock-context";
import { useSavedCars } from "@/lib/saved-cars-context";
import { CarCard } from "@/components/car-card";
import { Button } from "@/components/ui/button";

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
  const [shareStatus, setShareStatus] = useState("");
  const [copyLink, setCopyLink] = useState("");
  const share = async () => {
    const url = shortlistUrl(shownIds);
    try {
      if (navigator.share)
        await navigator.share({ title: "Cars to take a look at", url });
      else {
        await navigator.clipboard.writeText(url);
        setShareStatus("Shortlist link copied");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCopyLink(url);
      setShareStatus("Copy the link below to share these cars.");
    }
  };
  const cars = shownIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is Car => Boolean(car));

  const unavailableIds =
    !isLoading && stock
      ? shownIds.filter((id) => !stock.cars.some((car) => car.id === id))
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
    <div className="friendly-page friendly-saved luxxy-shell min-h-screen bg-background pb-24 pt-8 md:pt-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/stock"
          className="inline-flex items-center gap-3 font-display text-[12px] font-normal text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to showroom
        </Link>

        <div className="friendly-shortlist-intro mt-6">
          <PageHeading
            eyebrow={websiteText(settings, "savedEyebrow")}
            title={sharedIds ? "Shared shortlist" : websiteText(settings, "savedTitle")}
            description={
              sharedIds
                ? "Someone shared these cars with you. Prices and availability reflect the latest stock. Your own saved cars are unchanged."
                : websiteText(settings, "savedDescription")
            }
            action={
              shownIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-4">
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="text-saved-count"
                  >
                    {cars.length} {cars.length === 1 ? "car" : "cars"}{" "}
                    {sharedIds ? "in this shortlist" : "saved"}
                  </p>
                  <Button variant="outline" onClick={share}>
                    {shownIds.length > 12
                      ? "Share first 12 cars"
                      : "Share shortlist"}
                  </Button>
                  {!sharedIds && (
                    <Button
                      variant="outline"
                      onClick={() => clearSaved()}
                      data-testid="button-clear-saved"
                    >
                      <Trash2 className="h-4 w-4" /> Clear all
                    </Button>
                  )}
                </div>
              )
            }
          />
        </div>

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
          <Link href="/saved" className="text-link mt-3 min-h-11">
            View my saved cars
          </Link>
        )}
        {unavailableIds.length > 0 && (
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
          <div className="mt-6 flex flex-col gap-6">
            {cars.map((car) => (
              <div key={car.id} className="overflow-hidden rounded-md border border-border bg-card"><CarCard car={car} layout="row" /><SavedCarDetails car={car} /></div>
            ))}
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
              ? "This link has no vehicles in our current stock. Browse the showroom for available cars."
              : unavailableIds.length
                ? "Your saved vehicles have left our current stock. Browse the showroom to start a new shortlist."
                : "Tap the heart on any car to save it here."}
          </PageEmptyState>
        )}
      </div>
    </div>
  );
}
