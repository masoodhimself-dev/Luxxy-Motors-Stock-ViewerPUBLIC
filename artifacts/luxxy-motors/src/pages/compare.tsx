import { SiWhatsapp } from 'react-icons/si';
import { useState } from 'react';
import { PageHeading, PageEmptyState } from '@/components/page-ui';
import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Calendar, MessageCircle, Phone, Plus, Scale, X } from 'lucide-react';
import { useStock, type Car } from '@/lib/stock-context';
import { MAX_COMPARE, useSavedCars } from '@/lib/saved-cars-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getPhoneHref, getVehicleBookingHref, getVehicleWhatsAppHref, recordBookingIntent, recordContactIntent } from '@/lib/cta-helpers';
import { cn, formatMileage, formatPrice, getSafeImageUrl, getThumbnailUrl, vehicleRegistration } from '@/lib/utils';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { vehicleLabelFor } from '@/components/saved-car-controls';
import { trackEvent } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import { insuranceHistoryLabel } from '@/lib/vehicle-history';

type CompareRow = {
  label: string;
  render: (car: Car) => string;
  /** Marks the stronger of two values, where one is objectively preferable. */
  preference?: {
    pick: 'lower' | 'higher';
    value: (car: Car) => number | null;
    hint: string;
  };
};

const rows: CompareRow[] = [
  {
    label: 'Price',
    render: (car) => (car.price != null ? formatPrice(car.price, car.currency) : 'POA'),
    preference: { pick: 'lower', value: (car) => car.price, hint: 'Lower price' },
  },
  {
    label: 'Year',
    render: (car) => (car.year ? String(car.year) : '—'),
    preference: { pick: 'higher', value: (car) => car.year, hint: 'Newer' },
  },
  {
    label: 'Mileage',
    render: (car) => (car.mileage != null ? formatMileage(car.mileage) : car.mileageText || '—'),
    preference: { pick: 'lower', value: (car) => car.mileage, hint: 'Fewer miles' },
  },
  { label: 'Fuel', render: (car) => car.fuel || '—' },
  { label: 'Gearbox', render: (car) => car.transmission || '—' },
  { label: 'Engine', render: (car) => car.engineSize || (car.engineCC ? `${car.engineCC}cc` : '—') },
  { label: 'Body', render: (car) => car.bodyType || '—' },
  { label: 'Doors', render: (car) => (car.doors ? String(car.doors) : '—') },
  { label: 'Seats', render: (car) => (car.seats ? String(car.seats) : '—') },
  { label: 'Colour', render: (car) => car.colour || '—' },
  { label: 'Drivetrain', render: (car) => car.drivetrain || '—' },
  {
    label: 'Owners',
    render: (car) => (car.owners != null ? String(car.owners) : '—'),
    preference: { pick: 'lower', value: (car) => car.owners, hint: 'Fewer owners' },
  },
  { label: 'Emissions', render: (car) => car.emissionClass || '—' },
  {
    label: 'History',
    render: (car) => insuranceHistoryLabel(car.writeOffCategory),
  },
  { label: 'Registration', render: (car) => vehicleRegistration(car) || '—' },
];

const gridTemplate = 'grid grid-cols-2 gap-x-3 md:grid-cols-[minmax(8rem,.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-8';

function preferredIndex(row: CompareRow, cars: Car[]) {
  if (!row.preference || cars.length < 2) return null;

  const values = cars.map(row.preference.value);
  if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;

  const [first, second] = values as number[];
  if (first === second) return null;

  const lowerIndex = first < second ? 0 : 1;
  return row.preference.pick === 'lower' ? lowerIndex : 1 - lowerIndex;
}

function CompareColumn({ car, onRemove }: { car: Car; onRemove: () => void }) {
  const { settings: dealerConfig } = useDealerSettings();
  const label = vehicleLabelFor(car);
  const thumbnail = getThumbnailUrl(car) || (car.images?.[0] ? getSafeImageUrl(car.images[0]) : '');
  const registration = vehicleRegistration(car);
  const phoneHref = getPhoneHref(dealerConfig);
  const whatsappHref = getVehicleWhatsAppHref(car, 'get more information about this vehicle', dealerConfig);
  const bookingHref = getVehicleBookingHref(car);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-md border border-border bg-card shadow-none">
      <div className="relative aspect-[4/3] sm:aspect-[16/9] w-full border-b border-primary bg-primary/10">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-[11px] font-semibold tracking-normal text-muted-foreground">No photo</div>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} from comparison`}
          data-testid={`button-compare-remove-${car.id}`}
          className="absolute right-2 top-2 grid h-11 w-11 place-items-center bg-background border border-primary text-primary transition-all hover:bg-accent hover:text-accent-foreground hover:border-accent shadow-none"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3 sm:p-5">
        <Link
          href={`/vehicle/${car.id}`}
          onClick={() => trackEvent('vehicle_opened', { source: 'compare_tray' })}
          className="group block"
        >
          <h3 className="font-display text-base sm:text-xl font-semibold tracking-tight text-primary group-hover:text-accent">
            {label}
          </h3>
          {(car.variant || car.trim) && (
            <p className="mt-2 text-xs font-normal text-muted-foreground line-clamp-2">
              {car.variant || car.trim}
            </p>
          )}
        </Link>

        <p className="luxxy-price mt-3 text-xl sm:text-2xl" data-testid={`compare-price-${car.id}`}>{car.price != null ? formatPrice(car.price, car.currency) : 'Price on application'}</p>
        <p className="mt-1 text-xs text-muted-foreground">{car.registrationBand || car.year}</p>

        {registration && (
          <div className="mt-4">
            <UKNumberPlate size="sm" value={registration} className="w-[104px]" testId="compare-plate" />
          </div>
        )}

        <div className="mt-auto pt-4 flex flex-col gap-3">
          <Button
            asChild
            className="w-full h-11 px-2 rounded-md bg-primary font-display text-[12px] font-normal text-primary-foreground shadow-none transition-all hover:bg-accent active:shadow-none"
          >
            <a href={bookingHref} onClick={() => recordBookingIntent({ source: 'compare_page', vehicleContext: true })}>
              <Calendar className="h-4 w-4" /> Book
            </a>
          </Button>
          <div className="grid grid-cols-2 gap-2">
            {phoneHref && (
              <Button
                asChild
                variant="outline"
                className="min-w-0 h-11 px-0 sm:px-3 rounded-md border border-border bg-card font-display text-[11px] font-normal text-primary shadow-none transition-all hover:bg-primary hover:text-primary-foreground"
              >
                <a aria-label={`Call about ${label}`} href={phoneHref} onClick={() => recordContactIntent({ channel: 'call', car, source: 'compare' })}>
                  <Phone className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Call</span>
                </a>
              </Button>
            )}
            {whatsappHref && (
              <Button
                asChild
                variant="outline"
                className="min-w-0 h-11 px-0 sm:px-3 rounded-md border border-[hsl(var(--contact))] bg-background font-display text-[11px] font-normal text-[hsl(var(--contact))] shadow-none transition-all hover:bg-[hsl(var(--contact))] hover:text-white"
              >
                <a aria-label={`WhatsApp about ${label}`} href={whatsappHref} target="_blank" rel="noopener noreferrer" onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: 'compare' })}>
                  <SiWhatsapp className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">WhatsApp</span>
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <div className="flex flex-col border border-border bg-secondary/30 p-4 sm:p-6">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="grid h-11 w-11 place-items-center text-muted-foreground mb-3">
          <Plus className="h-8 w-8" />
        </div>
        <p className="font-display text-[13px] font-semibold tracking-normal text-primary mb-2">Add a second car</p>
        <p className="text-[11px] font-normal leading-relaxed text-muted-foreground">
          Pick another car to compare specs side by side.
        </p>
      </div>
      <Button asChild variant="outline" className="mt-6 w-full h-12 rounded-md border border-border bg-card font-display text-[11px] font-normal text-primary shadow-none transition-all hover:bg-primary hover:text-primary-foreground hover:shadow-none">
        <Link href="/stock">Browse stock</Link>
      </Button>
    </div>
  );
}

export default function Compare() {
  const { settings } = useDealerSettings();
  const { stock, isLoading, error } = useStock();
  const { compareIds, removeFromCompare } = useSavedCars();
  const [differencesOnly, setDifferencesOnly] = useState(false);

  const cars = compareIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is Car => Boolean(car));

  const visibleRows = differencesOnly && cars.length === 2 ? rows.filter((row) => row.render(cars[0]) !== row.render(cars[1])) : rows;

  if (!settings.presentation?.comparisonEnabled) return <div className="container mx-auto px-4 py-16"><h1 className="heading-2">Browse your next car</h1><p className="mt-3 text-muted-foreground">Save the cars you like and ask our team for help choosing.</p><Link href="/saved" className="text-link mt-5 min-h-11">View saved cars</Link><Link href="/stock" className="text-link ml-6 min-h-11">Browse stock</Link></div>;

  if (isLoading && compareIds.length > 0) {
    return (
      <div className="container mx-auto px-4 py-16 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading comparison">
        <div className="h-4 w-40 animate-pulse bg-primary/20 border border-primary" />
        <div className="mt-8 h-16 w-80 max-w-full animate-pulse bg-primary/20 border border-primary" />
        <div className="mt-12 space-y-6">
          <div className="h-64 animate-pulse bg-primary/10 border border-primary shadow-none" />
          <div className="h-64 animate-pulse bg-primary/10 border border-primary shadow-none" />
        </div>
      </div>
    );
  }

  return (
    <div className="friendly-page friendly-compare luxxy-shell min-h-screen bg-background pb-24 pt-8 md:pt-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/stock"
          className="inline-flex items-center gap-3 font-display text-[12px] font-normal text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to showroom
        </Link>

        <div className="friendly-shortlist-intro mt-6"><PageHeading eyebrow="Side by side" title="Compare cars" description="Price, specification and running details at a glance." action={<p className="text-sm text-muted-foreground">{cars.length} of {MAX_COMPARE} cars selected</p>} /></div>

        {error ? (
          <div role="alert"><PageEmptyState title="Stock could not be loaded" action={<Button onClick={() => window.location.reload()}>Try again</Button>}>
            Your selections are still saved on this device. Try again to check current availability.
          </PageEmptyState></div>
        ) : cars.length === 0 ? (
          <PageEmptyState title="Choose cars to compare" action={<Button asChild><Link href="/stock">Browse stock <ArrowRight className="h-4 w-4" /></Link></Button>}>
            Choose Compare on any {MAX_COMPARE} cars to see their details side by side.
          </PageEmptyState>
        ) : (
          <>
            <div className={cn(gridTemplate, 'mt-8 gap-y-6 pb-8')}>
              <p className="font-display text-[15px] font-semibold tracking-normal col-span-2 hidden self-end pb-2 text-muted-foreground md:col-span-1 md:block">
                THE CARS
              </p>
              {cars.map((car) => (
                <CompareColumn key={car.id} car={car} onRemove={() => removeFromCompare(car.id)} />
              ))}
              {cars.length < MAX_COMPARE && <EmptySlot />}
            </div>

            {cars.length === 2 && <label className="mb-3 inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"><input type="checkbox" checked={differencesOnly} onChange={(event) => setDifferencesOnly(event.target.checked)} className="h-5 w-5 accent-primary" />Show differences only</label>}
            <div
              data-testid="compare-sticky-heading"
              className={cn(
                gridTemplate,
                'sticky top-[var(--site-header-height,5.5rem)] z-20 items-center border-t border-border border-b border-b-border bg-background px-4 py-3 sm:px-8 lg:px-10 shadow-none',
              )}
            >
              <p className="font-display text-[12px] font-semibold tracking-normal hidden text-primary md:block">Specs</p>
              {cars.map((car) => (
                <p key={car.id} className="min-w-0 break-words font-display text-sm font-semibold leading-5 text-primary">
                  {vehicleLabelFor(car)}
                </p>
              ))}
              {cars.length < MAX_COMPARE && (
                <p className="truncate font-bold text-[10px] tracking-normal text-muted-foreground">Choose another car</p>
              )}
            </div>

            <dl data-testid="compare-table" className="border-x border-b border-border bg-card shadow-none p-4 sm:p-8 lg:p-10 mb-10">
              {!visibleRows.length && <p className="py-4 text-sm text-muted-foreground">The listed specifications match. Turn off “Show differences only” to see every detail.</p>}
              {visibleRows.map((row) => {
                const best = preferredIndex(row, cars);

                return (
                  <div key={row.label} className={cn(gridTemplate, 'gap-y-2 border-b border-primary/10 py-4 last:border-0')}>
                    <dt className="font-display text-[12px] font-semibold tracking-normal col-span-2 self-center text-muted-foreground md:col-span-1">{row.label}</dt>
                    {cars.map((car, index) => (
                      <dd
                        key={car.id}
                        className={cn(
                          'flex flex-wrap items-center gap-2 font-medium text-[13px]  tracking-normal leading-relaxed text-foreground',
                          row.label === 'Price' && 'font-display text-lg font-semibold tracking-tight',
                          best === index && 'text-primary bg-primary/5 -m-2 p-2 border border-primary/10',
                        )}
                      >
                        <span className="min-w-0 break-words">{row.render(car)}</span>
                        {best === index && row.preference && (
                          <span
                            title={row.preference.hint}
                            className="inline-flex shrink-0 items-center text-accent font-display text-[11px] font-medium"
                          >
                            {row.preference.hint}
                          </span>
                        )}
                      </dd>
                    ))}
                    {cars.length < MAX_COMPARE && <dd className="text-[13px] font-bold text-muted-foreground">—</dd>}
                  </div>
                );
              })}
            </dl>
          </>
        )}
      </div>
    </div>
  );
}
