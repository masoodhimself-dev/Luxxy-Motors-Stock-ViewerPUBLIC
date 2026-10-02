import { websiteText } from "@/lib/website-content";
import { questionMessage } from "@/lib/vehicle-questions";
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, Camera, Car as CarIcon, CircleAlert } from 'lucide-react';
import { Link, useLocation, useSearch } from 'wouter';
import { EnquiryForm } from '@/components/enquiry-form';
import { TestDriveBooking } from '@/components/test-drive-booking';
import { useStock } from '@/lib/stock-context';
import type { EnquiryType } from '@/lib/cta-helpers';
import { formatMileage, formatPrice, getThumbnailUrl } from '@/lib/utils';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { enquiryPageMeta } from '@/lib/page-meta';
import { navigateToHomeTarget } from '@/lib/home-navigation';

const enquiryTypes: EnquiryType[] = ['viewing', 'general', 'delivery', 'warranty', 'part_exchange'];
const headings: Record<EnquiryType, { eyebrow: string; title: string; description: string }> = {
  viewing: { eyebrow: 'Visit Luxxy Motors', title: 'Book a test drive', description: 'Choose a date and time to see the car and ask the team any questions.' },
  general: { eyebrow: 'Talk to the team', title: 'How can we help?', description: 'A direct line to the team behind the showroom. We will come back to you with a useful answer.' },
  delivery: { eyebrow: 'Nationwide delivery', title: 'Arrange delivery', description: 'Tell us your location and the car you are interested in. We will confirm delivery options and costs.' },
  warranty: { eyebrow: 'Added peace of mind', title: 'Warranty enquiries', description: 'We will talk you through the warranty options available for the vehicle you have in mind.' },
  part_exchange: { eyebrow: 'Part exchange', title: 'Part-exchange your car', description: 'Tell us about your car. Choose your next one. Choose how to send your details.' },
};

const metaHeadings: Record<EnquiryType, string> = {
  viewing: 'Book a test drive',
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
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const requestedType = params.get('type') as EnquiryType | null;
  const [type, setType] = useState<EnquiryType>(requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general');
  useEffect(() => { setType(requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general'); }, [requestedType]);
  const vehicleId = params.get('vehicleId');
  const vehicle = stock?.cars.find((car) => car.id === vehicleId);
  const copy = {
    ...headings[type],
    eyebrow: type === 'viewing' ? `Visit ${dealerConfig.identity.name}` : type === 'general' ? dealerConfig.identity.name : headings[type].eyebrow,
    title: websiteText(dealerConfig, `${type}Title`),
    description: websiteText(dealerConfig, `${type}Description`),
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
        { label: 'Year', value: vehicle.year ? String(vehicle.year) : null },
        { label: 'Mileage', value: vehicle.mileage ? formatMileage(vehicle.mileage) : vehicle.mileageText },
        { label: 'Fuel', value: vehicle.fuel },
        { label: 'Gearbox', value: vehicle.transmission },
      ].filter((highlight): highlight is { label: string; value: string } => Boolean(highlight.value))
    : [];
  const changeCar = () => navigateToHomeTarget('stock', location, setLocation);

  if (type === 'viewing') return <TestDriveBooking vehicle={vehicle} stockCars={stock?.cars ?? []} isLoading={isLoading} error={error} missingVehicle={Boolean(vehicleId && !vehicle)} />;

  return (
    <div className="friendly-page friendly-enquire luxxy-shell min-h-screen bg-background pb-20 pt-4 sm:pt-8 md:pt-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-3 font-display text-[12px] font-normal text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to showroom
        </Link>
        <div className="mt-3 grid items-start gap-5 sm:mt-5 sm:gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:gap-12">
          <section className="enquiry-introduction flex flex-col">
            <div className="friendly-banner">
            <p className="mb-2 font-display text-[12px] font-semibold tracking-normal text-accent sm:mb-4">
              {copy.eyebrow}
            </p>
            <h1 className="heading-2 text-primary">{copy.title}</h1>
            <p className="mt-3 text-sm font-normal leading-relaxed text-primary/70 sm:mt-6 sm:text-[15px]">
              {copy.description}
            </p>
            </div>

            {type === 'part_exchange' ? (
              <div className="mt-6 hidden space-y-5 border-t border-border pt-5 text-sm leading-6 text-muted-foreground lg:block">
                <p>Tell us about your car, choose one from our stock, then send your details here or through WhatsApp.</p>
                <ol className="hidden space-y-3 lg:block">
                  <li><span className="mr-3 text-accent">01</span>Your car and mileage</li>
                  <li><span className="mr-3 text-accent">02</span>Condition, keys and V5C</li>
                  <li><span className="mr-3 text-accent">03</span>Your next car</li>
                  <li><span className="mr-3 text-accent">04</span>Contact details and review</li>
                </ol>
                <p className="text-xs">Have photos ready to attach in the WhatsApp chat. No obligation to proceed.</p>
              </div>
            ) : vehicle ? (
              <div className="mt-5 hidden flex-col gap-4 lg:flex" data-testid="enquiry-vehicle-summary">
                <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                  <p className="font-display text-[13px] font-semibold text-primary">Your selected car</p>
                  <Link href="/stock" onClick={(event) => { event.preventDefault(); changeCar(); }} className="inline-flex min-h-11 shrink-0 items-center font-display text-xs text-accent underline underline-offset-4 transition-colors hover:text-primary">
                    Change car
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
                </div>
                <div>
                  <h2 className="font-display text-xl font-semibold tracking-tight text-primary">{selectedVehicleName}</h2>
                  <p className="mt-2 text-xs font-normal text-primary/70">{vehicle.variant || vehicle.trim}</p>
                  {vehicle.price != null && (
                    <p className="luxxy-price-inline mt-3 text-xl font-semibold text-primary">
                      {formatPrice(vehicle.price, vehicle.currency)}
                    </p>
                  )}
                </div>
                {vehicleHighlights.length > 0 && (
                  <dl className="grid grid-cols-2 gap-x-6">
                    {vehicleHighlights.map(({ label, value }) => (
                      <div key={label} className="border-t border-border py-3" data-testid={`highlight-${label.toLowerCase()}`}>
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="mt-1 text-sm font-semibold text-primary">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            ) : (
              <div className="mt-5 hidden flex-col gap-4 border-t border-border pt-5 lg:flex" data-testid="enquiry-no-vehicle-summary">
                <CarIcon className="h-8 w-8 text-primary/40" />
                <div>
                  <p className="font-display text-lg font-semibold tracking-tight text-primary">No vehicle selected</p>
                  <p className="mt-2 text-[12px] font-normal leading-relaxed text-primary/70">
                    If you have a specific car in mind, browse the showroom to select it before making an enquiry.
                  </p>
                </div>
                <Link
                  href="/stock"
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
            <div className="enquiry-form-panel">
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
                    <p className="mt-2 text-primary/70">{type === 'part_exchange' ? 'Please reload to choose a current stock vehicle, or call the showroom.' : 'You can still send an enquiry and our team will help match it to the right vehicle.'}</p>
                  </div>
                </div>
              ) : vehicleId && !vehicle ? (
                <div className="mb-10 flex items-start gap-4 border border-accent/50 bg-accent/10 p-6 text-[13px] font-normal leading-relaxed text-primary" role="alert" data-testid="status-vehicle-unavailable">
                  <CircleAlert className="h-6 w-6 shrink-0 text-accent" />
                  <div>
                    <p className="font-display text-[14px] font-semibold text-accent">This vehicle has just left the showroom.</p>
                    <p className="mt-2 text-primary/70">{type === 'part_exchange' ? 'Choose another available vehicle in the Your next car step.' : 'You can still send a general enquiry below and we will help find a close alternative.'}</p>
                  </div>
                </div>
              ) : null}

              <EnquiryForm initialMessage={type === "general" && params.get("searchRequest") ? params.get("searchRequest")!.slice(0, 500) : vehicle && type === "general" ? questionMessage(params.get("question")) : ""} onTypeChange={setType} onChangeCar={changeCar} initialType={type} vehicle={vehicle} stockCars={stock?.cars ?? []} />
            </div>

            {dealerConfig.contact.phone && <p className="mt-5 text-sm text-muted-foreground">
              Prefer to talk? <a className="text-primary underline underline-offset-4" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>Call the showroom</a>.
            </p>}


          </section>
        </div>
      </div>
    </div>
  );
}
