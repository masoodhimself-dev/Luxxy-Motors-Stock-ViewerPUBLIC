import { Link } from 'wouter';
import { ArrowLeft, ArrowRight, Calendar, MessageCircle, Phone, Plus, Scale, X } from 'lucide-react';
import { useStock, type Car } from '@/lib/stock-context';
import { MAX_COMPARE, useSavedCars } from '@/lib/saved-cars-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getPhoneHref, getVehicleBookingHref, getVehicleWhatsAppHref } from '@/lib/cta-helpers';
import { cn, formatMileage, formatPrice, getSafeImageUrl, getThumbnailUrl, vehicleRegistration } from '@/lib/utils';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { vehicleLabelFor } from '@/components/saved-car-controls';

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
    render: (car) => (car.price ? formatPrice(car.price, car.currency) : 'POA'),
    preference: { pick: 'lower', value: (car) => car.price, hint: 'Lower price' },
  },
  {
    label: 'Year',
    render: (car) => (car.year ? String(car.year) : '—'),
    preference: { pick: 'higher', value: (car) => car.year, hint: 'Newer' },
  },
  {
    label: 'Mileage',
    render: (car) => (car.mileage ? formatMileage(car.mileage) : car.mileageText || '—'),
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
    render: (car) => (car.owners ? String(car.owners) : '—'),
    preference: { pick: 'lower', value: (car) => car.owners, hint: 'Fewer owners' },
  },
  { label: 'Emissions', render: (car) => car.emissionClass || '—' },
  {
    label: 'History',
    render: (car) => {
      const category = (car.writeOffCategory || '').toUpperCase();
      if (category.includes('S')) return 'Cat S recorded';
      if (category.includes('N')) return 'Cat N recorded';
      return 'No write-off recorded';
    },
  },
  { label: 'Registration', render: (car) => vehicleRegistration(car) || '—' },
];

const gridTemplate = 'grid grid-cols-2 gap-x-3 md:grid-cols-[minmax(7rem,.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-6';

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
    <div className="flex h-full flex-col border border-border/70 bg-card" data-testid={`compare-column-${car.id}`}>
      <div className="relative aspect-[4/3] overflow-hidden bg-secondary/60">
        <Link href={`/vehicle/${car.id}`} aria-label={`View details for ${label}`} className="absolute inset-0 block">
          {thumbnail ? (
            <img src={thumbnail} alt={label} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground">
              Photographs to follow
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} from your comparison`}
          data-testid={`button-remove-compare-${car.id}`}
          className="absolute right-2 top-2 grid h-9 w-9 place-items-center border border-border/60 bg-background/90 backdrop-blur-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
        <div>
          <h3 className="font-display text-lg font-semibold leading-tight tracking-tight text-primary sm:text-xl">
            <Link href={`/vehicle/${car.id}`} className="outline-none transition-colors hover:text-accent focus-visible:underline">
              {label}
            </Link>
          </h3>
          {(car.variant || car.trim) && (
            <p className="mt-1.5 line-clamp-2 text-[13px] leading-6 text-muted-foreground">{car.variant || car.trim}</p>
          )}
        </div>

        {registration && (
          <UKNumberPlate size="sm" value={registration} testId={`plate-compare-${car.id}`} className="w-[104px]" />
        )}

        <div className="mt-auto grid gap-2">
          <a
            href={bookingHref}
            target={bookingHref.startsWith('https://') ? '_blank' : undefined}
            rel={bookingHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
            aria-label={`${dealerConfig.bookViewing.ctaLabel} for ${label}`}
            data-vehicle-contact="booking"
            className="inline-flex h-11 items-center justify-center gap-2 bg-primary px-4 text-[13px] font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Calendar className="h-4 w-4" />
            {dealerConfig.bookViewing.ctaLabel}
          </a>
          <div className="grid grid-cols-2 gap-2">
            {phoneHref && (
              <a
                href={phoneHref}
                aria-label={`Call about ${label}`}
                data-vehicle-contact="call"
                className="inline-flex h-11 items-center justify-center gap-2 border border-border bg-background px-3 text-[13px] font-bold text-foreground transition-colors hover:border-primary/45 hover:bg-secondary"
              >
                <Phone className="h-4 w-4 text-accent" />
                Call
              </a>
            )}
            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp about ${label}`}
                data-vehicle-contact="whatsapp"
                className="inline-flex h-11 items-center justify-center gap-2 border border-[#1f7a4d]/30 bg-[#1f7a4d]/10 px-3 text-[13px] font-bold text-[#1b6543] transition-colors hover:bg-[#1f7a4d]/18"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptySlot() {
  return (
    <Link
      href="/"
      data-testid="link-compare-add-second"
      className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-3 border border-dashed border-border bg-card/40 p-6 text-center transition-colors hover:border-primary/45 hover:bg-card"
    >
      <span className="grid h-12 w-12 place-items-center border border-border bg-background">
        <Plus className="h-5 w-5 text-accent" />
      </span>
      <span className="font-display text-lg font-semibold text-primary">Add a second car</span>
      <span className="max-w-[16rem] text-[13px] leading-6 text-muted-foreground">
        Pick another car from the showroom and it will appear here side by side.
      </span>
    </Link>
  );
}

export default function Compare() {
  const { stock, isLoading } = useStock();
  const { compareIds, removeFromCompare, clearCompare } = useSavedCars();

  // Sold cars are dropped from the comparison by the tray, so anything left here is in stock.
  const cars = compareIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is Car => Boolean(car));

  // Without this the page claims nothing is picked while the stock list is still on its way.
  if (compareIds.length > 0 && (isLoading || !stock)) {
    return (
      <div className="container mx-auto px-4 py-16 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading your comparison">
        <div className="h-3 w-32 animate-pulse bg-secondary" />
        <div className="mt-6 h-14 w-72 max-w-full animate-pulse bg-secondary" />
        <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-[minmax(7rem,.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-6">
          <div className="hidden md:block" />
          <div className="h-80 animate-pulse bg-secondary" />
          <div className="h-80 animate-pulse bg-secondary" />
        </div>
        <div className="mt-8 space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-6 animate-pulse bg-secondary" />
          ))}
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
              <Scale className="h-4 w-4" /> Side by side
            </p>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-none tracking-[-.03em] text-primary md:text-5xl">
              Compare cars
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">
              The same figures for each car, in the same order, so the differences are easy to see.
            </p>
          </div>
          {cars.length > 0 && (
            <button
              type="button"
              onClick={clearCompare}
              data-testid="button-clear-compare"
              className="inline-flex h-11 shrink-0 items-center justify-center gap-2 border border-border bg-background px-4 text-[13px] font-bold text-foreground transition-colors hover:border-primary/45 hover:bg-secondary"
            >
              <X className="h-4 w-4" />
              Clear comparison
            </button>
          )}
        </div>

        {cars.length === 0 ? (
          <div className="mx-auto mt-10 max-w-2xl border border-dashed border-border bg-card px-6 py-20 text-center">
            <span className="mx-auto mb-6 grid h-14 w-14 place-items-center border border-border bg-secondary text-accent">
              <Scale className="h-6 w-6" />
            </span>
            <p className="font-display text-3xl font-semibold tracking-tight text-primary">No cars picked yet</p>
            <p className="mx-auto mb-8 mt-3 max-w-md text-base leading-7 text-muted-foreground">
              Choose Compare on any {MAX_COMPARE} cars in the showroom and their details will line up here.
            </p>
            <Link
              href="/"
              data-testid="link-compare-browse"
              className="inline-flex h-14 items-center justify-center gap-3 bg-primary px-8 text-base font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Browse the stock list
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <div className={cn(gridTemplate, 'mt-8 gap-y-4 pb-6')}>
              <p className="luxxy-label col-span-2 hidden self-end pb-1 text-muted-foreground md:col-span-1 md:block">
                The cars
              </p>
              {cars.map((car) => (
                <CompareColumn key={car.id} car={car} onRemove={() => removeFromCompare(car.id)} />
              ))}
              {cars.length < MAX_COMPARE && <EmptySlot />}
            </div>

            {/* Doubles as the table's column header and keeps the names in view while the rows scroll. */}
            <div
              className={cn(
                gridTemplate,
                'sticky top-[var(--site-header-height,4.5rem)] z-20 items-center border-t border-border border-b-2 border-b-accent bg-background/95 py-3 backdrop-blur-md',
              )}
            >
              <p className="luxxy-label hidden text-muted-foreground md:block">The cars</p>
              {cars.map((car) => (
                <p key={car.id} className="truncate font-display text-sm font-semibold text-primary">
                  {vehicleLabelFor(car)}
                </p>
              ))}
              {cars.length < MAX_COMPARE && (
                <p className="truncate text-[13px] text-muted-foreground/70">No second car yet</p>
              )}
            </div>

            <dl data-testid="compare-table">
              {rows.map((row) => {
                const best = preferredIndex(row, cars);

                return (
                  <div key={row.label} className={cn(gridTemplate, 'gap-y-1 border-b border-border/70 py-3.5')}>
                    <dt className="luxxy-label col-span-2 self-center text-muted-foreground md:col-span-1">{row.label}</dt>
                    {cars.map((car, index) => (
                      <dd
                        key={car.id}
                        className={cn(
                          'flex items-center gap-1.5 text-[13px] font-semibold leading-6 text-foreground',
                          row.label === 'Price' && 'luxxy-price-inline',
                          best === index && 'text-primary',
                        )}
                      >
                        <span className="min-w-0 break-words">{row.render(car)}</span>
                        {best === index && row.preference && (
                          <span
                            title={row.preference.hint}
                            className="inline-flex shrink-0 items-center bg-accent/18 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[.1em] text-primary"
                          >
                            {row.preference.hint}
                          </span>
                        )}
                      </dd>
                    ))}
                    {cars.length < MAX_COMPARE && <dd className="text-[13px] text-muted-foreground/60">—</dd>}
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
