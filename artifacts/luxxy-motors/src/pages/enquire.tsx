import { useMemo, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, BadgeCheck, CalendarDays, Camera, Car as CarIcon, CircleAlert, Clock3, Fuel, Gauge, Mail, MapPin, Phone, Settings2, ShieldCheck } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { EnquiryForm } from '@/components/enquiry-form';
import { useStock } from '@/lib/stock-context';
import type { EnquiryType } from '@/lib/cta-helpers';
import { formatMileage, formatPrice, getThumbnailUrl } from '@/lib/utils';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { enquiryPageMeta } from '@/lib/page-meta';
import { navigateToHomeTarget } from '@/lib/home-navigation';

const enquiryTypes: EnquiryType[] = ['viewing', 'general', 'delivery', 'warranty', 'part_exchange'];
const headings: Record<EnquiryType, { eyebrow: string; title: string; description: string }> = {
  viewing: { eyebrow: 'Private showroom visit', title: 'Book a viewing', description: 'Choose a time that suits you. We will have the vehicle ready, warmed up and waiting.' },
  general: { eyebrow: 'Talk to the team', title: 'How can we help?', description: 'A direct line to the team behind the showroom. We will come back to you with a useful answer.' },
  delivery: { eyebrow: 'Nationwide delivery', title: 'Arrange delivery', description: 'Share where you are and we will map out the simplest route to getting your next car home.' },
  warranty: { eyebrow: 'Added peace of mind', title: 'Warranty enquiries', description: 'We will talk you through the warranty options available for the vehicle you have in mind.' },
  part_exchange: { eyebrow: 'Part exchange', title: 'Part-exchange your car', description: 'Tell us a little about your car and we will help you understand your options.' },
};

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
  const [location, setLocation] = useLocation();
  const { stock, isLoading, error } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedType = params.get('type') as EnquiryType | null;
  const type = requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general';
  const vehicleId = params.get('vehicleId');
  const vehicle = stock?.cars.find((car) => car.id === vehicleId);
  const copy = {
    ...headings[type],
    eyebrow: type === 'general' ? `${dealerConfig.identity.name}` : headings[type].eyebrow,
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
    <div className="luxxy-shell min-h-screen bg-background pb-20 pt-8 md:pt-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex items-center gap-3 font-display text-[12px] font-normal text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to showroom
        </Link>
        <div className="mt-5 grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:gap-12">
          <section className="flex flex-col lg:sticky lg:top-24">
            <p className="font-display text-[12px] font-semibold tracking-normal text-accent mb-4">
              {copy.eyebrow}
            </p>
            <h1 className="heading-2 text-primary">{copy.title}</h1>
            <p className="mt-6 text-[15px] font-normal leading-relaxed text-primary/70">
              {copy.description}
            </p>

            {vehicle ? (
              <div className="mt-5 hidden flex-col gap-4 lg:flex" data-testid="enquiry-vehicle-summary">
                <div className="flex items-center justify-between border-b border-primary/10 pb-4">
                  <p className="font-display text-[13px] font-semibold tracking-normal text-primary">Selected Vehicle</p>
                  <Link href={`/vehicle/${vehicle.id}`} className="font-display text-[11px] font-normal text-accent hover:text-primary transition-colors">
                    Change
                  </Link>
                </div>
                <div className="relative hidden aspect-[4/3] w-full overflow-hidden rounded-md bg-muted lg:block">
                  {vehicleImage ? (
                    <img src={vehicleImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-primary/20">
                      <Camera className="h-8 w-8" />
                    </div>
                  )}
                  {vehicle.price && (
                    <div className="absolute bottom-3 right-3 bg-background px-3 py-1 font-display text-lg font-semibold tracking-tight text-primary border border-primary shadow-none">
                      {formatPrice(vehicle.price, vehicle.currency)}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-display text-xl font-semibold tracking-tight text-primary">{selectedVehicleName}</h3>
                  <p className="mt-2 text-xs font-normal text-primary/70">{vehicle.variant || vehicle.trim}</p>
                </div>
                {vehicleHighlights.length > 0 && (
                  <div className="hidden grid-cols-2 gap-4 border-t border-border pt-4 lg:grid">
                    {vehicleHighlights.map(({ label, value, icon: Icon }) => (
                      <div key={label} className="flex flex-col gap-1 border border-primary/10 bg-primary/5 p-3" data-testid={`highlight-${label.toLowerCase()}`}>
                        <span className="font-display text-[10px] font-semibold tracking-normal text-muted-foreground flex items-center gap-2"><Icon className="h-3.5 w-3.5" />{label}</span>
                        <span className="font-bold text-[13px] tracking-normal text-primary">{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 flex flex-col gap-4 border border-primary/20 bg-primary/5 p-6" data-testid="enquiry-no-vehicle-summary">
                <CarIcon className="h-8 w-8 text-primary/40" />
                <div>
                  <p className="font-display text-lg font-semibold tracking-tight text-primary">No vehicle selected</p>
                  <p className="mt-2 text-[12px] font-normal leading-relaxed text-primary/70">
                    If you have a specific car in mind, browse the showroom to select it before making an enquiry.
                  </p>
                </div>
                <Link
                  href="/#stock"
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    event.preventDefault();
                    navigateToHomeTarget('stock', location, setLocation);
                  }}
                  className="font-display text-[12px] font-semibold tracking-normal text-accent transition-colors hover:text-primary mt-2 flex items-center gap-2"
                >
                  Browse showroom stock <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
          </section>

          <section className="min-w-0" aria-labelledby="enquiry-form-heading">
            <div className="surface p-5 sm:p-7">
              {isLoading ? (
                <div className="space-y-6 py-12" data-testid="loading-enquiry-vehicle">
                  <div className="h-4 w-44 animate-pulse bg-primary/20 border border-primary" />
                  <div className="h-12 w-3/4 animate-pulse bg-primary/20 border border-primary" />
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="h-16 animate-pulse bg-primary/10 border border-primary" />
                    <div className="h-16 animate-pulse bg-primary/10 border border-primary" />
                  </div>
                  <div className="h-32 animate-pulse bg-primary/10 border border-primary" />
                </div>
              ) : error ? (
                <div className="flex items-start gap-4 border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/10 p-6 text-[13px] font-normal leading-relaxed text-primary" role="alert" data-testid="status-stock-error">
                  <CircleAlert className="h-6 w-6 shrink-0 text-[hsl(var(--accent))]" />
                  <div>
                    <p className="font-display text-[14px] font-semibold text-[hsl(var(--accent))]">We could not load the showroom details.</p>
                    <p className="mt-2 text-primary/70">You can still send an enquiry and our team will help match it to the right vehicle.</p>
                  </div>
                </div>
              ) : vehicleId && !vehicle ? (
                <div className="mb-10 flex items-start gap-4 border border-accent/50 bg-accent/10 p-6 text-[13px] font-normal leading-relaxed text-primary" role="alert" data-testid="status-vehicle-unavailable">
                  <CircleAlert className="h-6 w-6 shrink-0 text-accent" />
                  <div>
                    <p className="font-display text-[14px] font-semibold text-accent">This vehicle has just left the showroom.</p>
                    <p className="mt-2 text-primary/70">You can still send a general enquiry below and we will help find a close alternative.</p>
                  </div>
                </div>
              ) : null}

              <EnquiryForm initialType={type} vehicle={vehicle} stockCars={stock?.cars ?? []} />
            </div>

            <div className="mt-6 flex flex-wrap gap-5 border-t border-border pt-5">
              {[
                { icon: ShieldCheck, title: 'No pressure', text: 'A viewing is simply time with the car.' },
                { icon: Mail, title: 'Clear confirmation', text: 'Details arrive straight in our inbox.' },
                { icon: Phone, title: 'Real people', text: 'Questions? We are happy to talk.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex-1 min-w-[140px]" data-testid={`info-enquiry-${title.toLowerCase().replace(/\s+/g, '-')}`}>
                  <Icon className="h-5 w-5 text-accent mb-2" />
                  <p className="font-display text-sm font-semibold tracking-normal text-primary">{title}</p>
                  <p className="mt-2 text-xs font-normal leading-relaxed text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>

            {type === 'viewing' && !vehicle && (
              <Link
                href="/#stock"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  navigateToHomeTarget('stock', location, setLocation);
                }}
                className="font-display text-[11px] font-semibold tracking-normal group mt-8 inline-flex items-center gap-3 text-primary transition-colors hover:text-accent bg-primary/5 px-4 py-3 border border-primary/20 hover:border-accent"
                data-testid="link-browse-stock-from-enquiry"
              >
                Not sure which car yet? Browse current stock
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}