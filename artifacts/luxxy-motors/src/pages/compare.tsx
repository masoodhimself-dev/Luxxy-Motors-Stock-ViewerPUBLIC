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

const gridTemplate = 'grid grid-cols-2 gap-x-4 md:grid-cols-[minmax(8rem,.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-8';

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
    <div className="flex flex-col border-4 border-primary bg-background shadow-[6px_6px_0px_hsl(var(--primary))]">
      <div className="relative aspect-[4/3] w-full border-b-4 border-primary bg-primary/10">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-[11px] font-black uppercase tracking-widest text-primary/40">No photo</div>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} from comparison`}
          data-testid={`button-compare-remove-${car.id}`}
          className="absolute right-2 top-2 grid h-10 w-10 place-items-center bg-background border-2 border-primary text-primary transition-all hover:bg-accent hover:text-accent-foreground hover:border-accent shadow-[2px_2px_0px_hsl(var(--primary))]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-6">
        <Link
          href={`/vehicle/${car.id}`}
          onClick={() => trackEvent('vehicle_opened', { source: 'compare_tray' })}
          className="group block"
        >
          <h3 className="font-display text-xl sm:text-2xl font-black uppercase tracking-tighter text-primary group-hover:text-accent">
            {label}
          </h3>
          {(car.variant || car.trim) && (
            <p className="mt-2 text-[11px] font-bold uppercase tracking-widest text-primary/70 line-clamp-2">
              {car.variant || car.trim}
            </p>
          )}
        </Link>

        {registration && (
          <div className="mt-4">
            <UKNumberPlate size="sm" value={registration} className="w-[104px]" testId="compare-plate" />
          </div>
        )}

        <div className="mt-auto pt-6 flex flex-col gap-3">
          <Button
            asChild
            className="w-full h-12 rounded-none bg-primary font-display text-[12px] font-bold uppercase tracking-widest text-primary-foreground shadow-[3px_3px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[1px_1px_0px_hsl(var(--accent))] active:shadow-none"
          >
            <a href={bookingHref} onClick={() => recordBookingIntent({ source: 'compare_page', vehicleContext: true })}>
              <Calendar className="mr-2 h-4 w-4" /> Book
            </a>
          </Button>
          <div className="flex gap-3">
            {phoneHref && (
              <Button
                asChild
                variant="outline"
                className="flex-1 h-12 rounded-none border-2 border-primary bg-background font-display text-[11px] font-bold uppercase tracking-widest text-primary shadow-[2px_2px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[0px_0px_0px_hsl(var(--primary))]"
              >
                <a href={phoneHref} onClick={() => recordContactIntent({ channel: 'call', car, source: 'compare' })}>
                  <Phone className="mr-2 h-4 w-4" /> Call
                </a>
              </Button>
            )}
            {whatsappHref && (
              <Button
                asChild
                variant="outline"
                className="flex-1 h-12 rounded-none border-2 border-[#25D366] bg-background font-display text-[11px] font-bold uppercase tracking-widest text-[#25D366] shadow-[2px_2px_0px_#25D366] transition-all hover:bg-[#25D366] hover:text-white hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[0px_0px_0px_#25D366]"
              >
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer" onClick={() => recordContactIntent({ channel: 'whatsapp', car, source: 'compare' })}>
                  <MessageCircle className="mr-2 h-4 w-4" /> Msg
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
    <div className="flex flex-col border-4 border-dashed border-primary/20 bg-primary/5 p-6 md:p-8">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="grid h-16 w-16 place-items-center bg-background border-4 border-primary text-primary shadow-[4px_4px_0px_hsl(var(--primary))] mb-6">
          <Plus className="h-8 w-8" />
        </div>
        <p className="font-display text-[13px] font-black uppercase tracking-[0.1em] text-primary mb-2">ADD A SECOND CAR</p>
        <p className="text-[11px] font-bold uppercase tracking-widest leading-relaxed text-primary/60">
          Pick another car to compare specs side by side.
        </p>
      </div>
      <Button asChild variant="outline" className="mt-6 w-full h-12 rounded-none border-2 border-primary bg-background font-display text-[11px] font-bold uppercase tracking-widest text-primary shadow-[3px_3px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none">
        <Link href="/">Back to Stock</Link>
      </Button>
    </div>
  );
}

export default function Compare() {
  const { stock, isLoading } = useStock();
  const { compareIds, removeFromCompare } = useSavedCars();

  const cars = compareIds
    .map((id) => stock?.cars.find((car) => car.id === id))
    .filter((car): car is Car => Boolean(car));

  if (isLoading && compareIds.length > 0) {
    return (
      <div className="container mx-auto px-4 py-16 sm:px-6 lg:px-8" aria-busy="true" aria-label="Loading comparison">
        <div className="h-4 w-40 animate-pulse bg-primary/20 border-2 border-primary" />
        <div className="mt-8 h-16 w-80 max-w-full animate-pulse bg-primary/20 border-2 border-primary" />
        <div className="mt-12 space-y-6">
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

        <div className="mt-8 flex flex-col gap-5 border-b-4 border-primary pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-display text-[12px] font-black uppercase tracking-[0.2em] text-accent flex items-center gap-2 mb-4">
              <Scale className="h-4 w-4" /> Comparison
            </p>
            <h1 className="heading-1 text-primary">Compare</h1>
            <p className="mt-4 max-w-lg font-bold uppercase tracking-widest text-sm text-primary/70 leading-relaxed border-l-4 border-accent pl-4">
              Side-by-side details to help you choose the right fit.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 sm:items-end">
            <span className="font-display font-black text-sm uppercase tracking-widest text-primary bg-primary/5 border border-primary/10 px-3 py-1">
              {cars.length} OF {MAX_COMPARE} SLOTS USED
            </span>
          </div>
        </div>

        {cars.length === 0 ? (
          <div className="mx-auto mt-16 max-w-2xl border-4 border-dashed border-primary/20 bg-primary/5 px-6 py-24 text-center">
            <span className="mx-auto mb-6 grid h-16 w-16 place-items-center border-4 border-primary bg-background text-accent shadow-[4px_4px_0px_hsl(var(--primary))]">
              <Scale className="h-8 w-8" />
            </span>
            <p className="font-display text-4xl font-black uppercase tracking-tight text-primary">Nothing to Compare</p>
            <p className="mx-auto mb-10 mt-4 max-w-md font-bold uppercase tracking-widest text-sm leading-relaxed text-primary/60">
              Choose Compare on any {MAX_COMPARE} cars in the showroom and their details will line up here.
            </p>
            <Button asChild size="lg" className="h-16 rounded-none bg-primary font-display text-[13px] font-bold uppercase tracking-[0.15em] text-primary-foreground shadow-[4px_4px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_hsl(var(--accent))] active:shadow-none">
              <Link href="/">Browse Stock <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        ) : (
          <>
            <div className={cn(gridTemplate, 'mt-12 gap-y-6 pb-12')}>
              <p className="font-display text-[15px] font-black uppercase tracking-[0.2em] col-span-2 hidden self-end pb-2 text-primary/60 md:col-span-1 md:block">
                THE CARS
              </p>
              {cars.map((car) => (
                <CompareColumn key={car.id} car={car} onRemove={() => removeFromCompare(car.id)} />
              ))}
              {cars.length < MAX_COMPARE && <EmptySlot />}
            </div>

            <div
              className={cn(
                gridTemplate,
                'sticky top-[var(--site-header-height,5.5rem)] z-20 items-center border-t-4 border-primary border-b-4 border-b-accent bg-background/95 py-4 backdrop-blur-md shadow-sm',
              )}
            >
              <p className="font-display text-[12px] font-black uppercase tracking-[0.2em] hidden text-primary md:block">Specs</p>
              {cars.map((car) => (
                <p key={car.id} className="truncate font-display text-sm font-black uppercase tracking-wider text-primary">
                  {vehicleLabelFor(car)}
                </p>
              ))}
              {cars.length < MAX_COMPARE && (
                <p className="truncate font-bold text-[10px] uppercase tracking-widest text-primary/40">EMPTY SLOT</p>
              )}
            </div>

            <dl data-testid="compare-table" className="border-x-4 border-b-4 border-primary bg-background shadow-[8px_8px_0px_hsl(var(--primary))] p-6 sm:p-10 lg:p-12 mb-20">
              {rows.map((row) => {
                const best = preferredIndex(row, cars);

                return (
                  <div key={row.label} className={cn(gridTemplate, 'gap-y-2 border-b-2 border-primary/10 py-6 last:border-0')}>
                    <dt className="font-display text-[12px] font-black uppercase tracking-[0.1em] col-span-2 self-center text-primary/60 md:col-span-1">{row.label}</dt>
                    {cars.map((car, index) => (
                      <dd
                        key={car.id}
                        className={cn(
                          'flex items-center gap-3 font-bold text-[13px] uppercase tracking-wider leading-relaxed text-foreground',
                          row.label === 'Price' && 'font-display text-xl font-black tracking-tighter',
                          best === index && 'text-primary bg-primary/5 -m-2 p-2 border-2 border-primary/10',
                        )}
                      >
                        <span className="min-w-0 break-words">{row.render(car)}</span>
                        {best === index && row.preference && (
                          <span
                            title={row.preference.hint}
                            className="inline-flex shrink-0 items-center bg-accent text-accent-foreground px-2 py-1 font-display text-[9px] font-black uppercase tracking-[0.15em] shadow-[2px_2px_0px_hsl(var(--primary))]"
                          >
                            {row.preference.hint}
                          </span>
                        )}
                      </dd>
                    ))}
                    {cars.length < MAX_COMPARE && <dd className="text-[13px] font-bold text-primary/30">—</dd>}
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