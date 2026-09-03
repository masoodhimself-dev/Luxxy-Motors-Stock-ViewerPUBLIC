import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, Camera, Car as CarIcon, CircleAlert, Clock3, Fuel, Gauge, Mail, MapPin, Phone, Settings2, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';
import { EnquiryForm } from '@/components/enquiry-form';
import { useStock } from '@/lib/stock-context';
import type { EnquiryType } from '@/lib/cta-helpers';
import { formatMileage, formatPrice, getThumbnailUrl } from '@/lib/utils';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { enquiryPageMeta } from '@/lib/page-meta';

const enquiryTypes: EnquiryType[] = ['viewing', 'general', 'delivery', 'warranty', 'part_exchange'];
const headings: Record<EnquiryType, { eyebrow: string; title: string; description: string }> = {
  viewing: { eyebrow: 'Private showroom visit', title: 'Come and meet the car properly.', description: 'Choose a time that suits you. We will have the vehicle ready, warmed up and waiting.' },
  general: { eyebrow: 'Showroom concierge', title: 'Tell us what you need.', description: 'A direct line to the team behind the showroom. We will come back to you with a useful answer.' },
  delivery: { eyebrow: 'Nationwide delivery', title: 'Let’s get it to your door.', description: 'Share where you are and we will map out the simplest route to getting your next car home.' },
  warranty: { eyebrow: 'Added peace of mind', title: 'Ask us about cover.', description: 'We will talk you through the warranty options available for the vehicle you have in mind.' },
  part_exchange: { eyebrow: 'Part exchange', title: 'See what your current car is worth.', description: 'Tell us a little about your car and we will help you understand your options.' },
};

/** Short, scannable document titles — the on-page headings are full sentences. */
const metaHeadings: Record<EnquiryType, string> = {
  viewing: 'Book a viewing',
  general: 'Contact the showroom',
  delivery: 'Ask about delivery',
  warranty: 'Ask about warranty',
  part_exchange: 'Part-exchange valuation',
};

function vehicleName(vehicle: { title: string | null; make: string | null; model: string | null }) {
  return vehicle.title || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Selected vehicle';
}

export default function Enquire() {
  const { stock, isLoading, error } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedType = params.get('type') as EnquiryType | null;
  const type = requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general';
  const vehicleId = params.get('vehicleId');
  const vehicle = stock?.cars.find((car) => car.id === vehicleId);
  const copy = {
    ...headings[type],
    eyebrow: type === 'general' ? `${dealerConfig.identity.name} concierge` : headings[type].eyebrow,
  };
  const selectedVehicleName = vehicle ? vehicleName(vehicle) : 'your next car';

  usePageMeta(
    enquiryPageMeta(dealerConfig, {
      heading: metaHeadings[type],
      vehicleName: vehicle ? vehicleName(vehicle) : null,
    }),
  );

  const vehicleImage = vehicle ? getThumbnailUrl(vehicle) : '';
  const vehicleHighlights = vehicle
    ? [
        { label: 'Year', value: vehicle.year ? String(vehicle.year) : null, icon: CalendarDays },
        { label: 'Mileage', value: vehicle.mileage ? formatMileage(vehicle.mileage) : vehicle.mileageText, icon: Gauge },
        { label: 'Fuel', value: vehicle.fuel, icon: Fuel },
        { label: 'Gearbox', value: vehicle.transmission, icon: Settings2 },
      ].filter((highlight): highlight is { label: string; value: string; icon: typeof CarIcon } => Boolean(highlight.value))
    : [];

  return (
    <div className="luxxy-shell luxxy-grain min-h-screen">
      <div className="border-b border-border bg-background">
        <div className="container mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="luxxy-label inline-flex items-center gap-2 py-5 text-muted-foreground transition-colors hover:text-accent"
            data-testid="link-back-to-showroom"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Showroom
          </Link>
        </div>
      </div>

      <div className="container mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.28fr)] lg:items-start lg:gap-10">
          <aside className="luxxy-reveal order-2 border border-primary/25 bg-primary text-primary-foreground lg:order-1 lg:sticky lg:top-[calc(var(--site-header-height,4.5rem)+1.5rem)]">
            <div className="flex items-center justify-between gap-4 border-b border-white/12 px-6 py-4 sm:px-8">
              <span className="luxxy-label flex items-center gap-2.5 text-primary-foreground/60">
                <CarIcon className="h-4 w-4 text-accent" />
                {dealerConfig.identity.name} concierge
              </span>
              <span className="h-1.5 w-1.5 rotate-45 bg-accent" aria-hidden="true" />
            </div>

            <div className="px-6 py-8 sm:px-8 sm:py-10">
              <p className="luxxy-label text-accent">{copy.eyebrow}</p>
              <h1 className="mt-5 font-display text-[2.1rem] font-semibold leading-[1.02] tracking-[-.035em] sm:text-[2.5rem]">
                {copy.title}
              </h1>
              <p className="mt-5 max-w-sm text-sm leading-7 text-primary-foreground/70">{copy.description}</p>
            </div>

            {vehicle && (
              <div className="border-t border-white/12" data-testid="card-selected-vehicle">
                <div className="relative h-40 overflow-hidden bg-black/25 sm:h-48">
                  {vehicleImage ? (
                    <img
                      src={vehicleImage}
                      alt={selectedVehicleName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                      data-testid={`img-selected-vehicle-${vehicle.id}`}
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center text-primary-foreground/55" data-testid="empty-selected-vehicle-image">
                      <Camera className="h-7 w-7" />
                      <span className="luxxy-label mt-3">Image unavailable</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/30 to-transparent" />
                  <p className="luxxy-label absolute bottom-4 left-6 text-accent sm:left-8">You are enquiring about</p>
                </div>
                <div className="px-6 py-6 sm:px-8">
                  <h2 className="font-display text-[1.35rem] font-semibold leading-tight tracking-[-.025em]" data-testid={`text-selected-vehicle-${vehicle.id}`}>
                    {selectedVehicleName}
                  </h2>
                  {(vehicle.variant || vehicle.trim) && (
                    <p className="mt-2 text-sm leading-6 text-primary-foreground/60">{vehicle.variant || vehicle.trim}</p>
                  )}
                  {vehicle.price != null && (
                    <div className="mt-5 flex items-end justify-between gap-4 border-t border-white/12 pt-5">
                      <p className="luxxy-label text-primary-foreground/55">Price</p>
                      <p
                        className="font-display text-[1.7rem] font-semibold leading-none tracking-[-.03em] text-accent"
                        data-testid={`text-selected-vehicle-price-${vehicle.id}`}
                      >
                        {formatPrice(vehicle.price, vehicle.currency)}
                      </p>
                    </div>
                  )}
                  {vehicleHighlights.length > 0 && (
                    <dl className="mt-5 grid gap-3.5 border-t border-white/12 pt-5">
                      {vehicleHighlights.map(({ label, value, icon: Icon }) => (
                        <div key={label} className="flex items-baseline gap-2">
                          <dt className="luxxy-label flex shrink-0 items-center gap-1.5 text-primary-foreground/55">
                            <Icon className="h-3.5 w-3.5 text-accent" />
                            {label}
                          </dt>
                          <span className="luxxy-leader border-white/25" aria-hidden="true" />
                          <dd className="shrink-0 font-mono text-[13px] font-bold text-primary-foreground">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-5 border-t border-white/12 px-6 py-6 sm:px-8 bg-black/15">
              <div className="flex items-start gap-3">
                <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div>
                  <p className="text-sm font-bold text-primary-foreground">A considered visit</p>
                  <p className="mt-1.5 text-[13px] leading-6 text-primary-foreground/60">No hard sell. Take your time, ask anything, and drive away feeling certain.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <div>
                  <p className="text-sm font-bold text-primary-foreground">At the {dealerConfig.identity.name} showroom</p>
                  <p className="mt-1.5 text-[13px] leading-6 text-primary-foreground/60">Your confirmation will include everything you need for the journey.</p>
                </div>
              </div>
            </div>
          </aside>

          <section className="luxxy-reveal luxxy-reveal-1 order-1 min-w-0 lg:order-2">
            <div className="mb-5 flex items-center justify-between gap-4">
              <p className="luxxy-label flex items-center gap-3 text-muted-foreground">
                <span className="grid h-6 w-6 place-items-center bg-accent text-[11px] font-black text-accent-foreground">1</span>
                {type === 'viewing' ? 'Reserve your visit' : 'Start your enquiry'}
              </p>
              {type === 'viewing' && (
                <span className="luxxy-label hidden items-center gap-2 text-muted-foreground sm:flex">
                  <Clock3 className="h-3.5 w-3.5 text-accent" /> Takes about 2 minutes
                </span>
              )}
            </div>
            <div className="border border-border/70 bg-card p-5 sm:p-8 lg:p-10">
              {isLoading ? (
                <div className="space-y-5 py-10" data-testid="loading-enquiry-vehicle">
                  <div className="h-3 w-44 animate-pulse bg-secondary" />
                  <div className="h-10 w-3/4 animate-pulse bg-secondary" />
                  <div className="grid gap-4 sm:grid-cols-2"><div className="h-12 animate-pulse bg-secondary" /><div className="h-12 animate-pulse bg-secondary" /></div>
                  <div className="h-28 animate-pulse bg-secondary" />
                </div>
              ) : error ? (
                <div className="flex items-start gap-3 border border-[#c9a49c] bg-[#f7ece9] p-5 text-sm leading-6 text-[#8d3e34]" role="alert" data-testid="status-stock-error">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div><p className="font-bold">We could not load the showroom details.</p><p className="mt-1.5">You can still send an enquiry and our team will help match it to the right vehicle.</p></div>
                </div>
              ) : vehicleId && !vehicle ? (
                <div className="mb-8 flex items-start gap-3 border border-[#d4bd83] bg-[#f7f0dd] p-4 text-sm leading-6 text-[#80611f]" role="alert" data-testid="status-vehicle-unavailable">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <p><strong className="font-bold">This vehicle has just left the showroom.</strong> You can still send a general enquiry below and we will help find a close alternative.</p>
                </div>
              ) : null}
              <EnquiryForm initialType={type} vehicle={vehicle} stockCars={stock?.cars ?? []} />
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { icon: ShieldCheck, title: 'No pressure', text: 'A viewing is simply time with the car.' },
                { icon: Mail, title: 'Clear confirmation', text: 'Your details arrive straight in our inbox.' },
                { icon: Phone, title: 'Real people', text: 'Questions? We are happy to talk.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="border border-border/70 bg-card p-5" data-testid={`info-enquiry-${title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <Icon className="h-5 w-5 text-accent" />
                  <p className="mt-4 font-bold text-primary">{title}</p>
                  <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
            {type === 'viewing' && !vehicle && (
              <Link
                href="/#stock"
                className="luxxy-label group mt-7 inline-flex items-center gap-2 text-primary transition-colors hover:text-accent"
                data-testid="link-browse-stock-from-enquiry"
              >
                Not sure which car yet? Browse current stock
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
