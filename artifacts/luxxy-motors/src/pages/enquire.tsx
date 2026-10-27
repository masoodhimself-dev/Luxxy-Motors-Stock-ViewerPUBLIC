import { websiteText } from "@/lib/website-content";
import './customer-workflows.css';
import { questionMessage } from "@/lib/vehicle-questions";
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, Camera, CircleAlert } from '@/components/icons';
import { Link, useLocation, useSearch } from 'wouter';
import { EnquiryForm } from '@/components/enquiry-form';
import { PartExchangeForm } from '@/components/part-exchange-form';
import type { EnquiryInput } from '@workspace/api-client-react';
import { VehicleCall } from '@/components/vehicle-call';
import { TestDriveBooking } from '@/components/test-drive-booking';
import { useStock, type Car } from '@/lib/stock-context';
import type { EnquiryType } from '@/lib/cta-helpers';
import { formatMileage, formatPrice, getThumbnailUrl, vehicleRegistration } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { enquiryPageMeta } from '@/lib/page-meta';
import { navigateToHomeTarget } from '@/lib/home-navigation';

const enquiryTypes: EnquiryType[] = ['viewing', 'general', 'part_exchange'];
const headings: Record<EnquiryType, { eyebrow: string; title: string; description: string }> = {
  viewing: { eyebrow: 'Visit us', title: 'Book a Test Drive', description: 'Choose a date and time to see the car and ask us any questions.' },
  general: { eyebrow: 'Talk to us', title: 'How can we help?', description: 'Tell us what you’d like to know, and we’ll help with your next step.' },
  part_exchange: { eyebrow: 'Part exchange', title: 'Part-exchange your car', description: 'Tell us about your car. Choose your next one. Choose how to send your details.' },
};

const metaHeadings: Record<EnquiryType, string> = {
  viewing: 'Book a Test Drive',
  general: 'Contact us',
  part_exchange: 'Part-exchange valuation',
};

function vehicleName(vehicle: { title: string | null; make: string | null; model: string | null }) {
  return vehicle.title || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Selected vehicle';
}

export default function Enquire() { return <EnquirePage />; }

export function EnquirePage({testMode}:{testMode?:{type:'general'|'viewing'|'part_exchange';sessionId:string;config:ReturnType<typeof useDealerSettings>['settings'];customer:{name:string;email:string;phone:string};vehicle:{id:string;title:string;registration:string;price:number|null}|null;submit:(input:EnquiryInput)=>Promise<{appointmentStatus:string|null}>}} = {}) {
  const [location, setLocation] = useLocation();
  const { stock, isLoading, error } = useStock();
  const { settings: liveDealerConfig } = useDealerSettings();
  const dealerConfig=testMode?.config ?? liveDealerConfig;
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const requestedType = testMode ? testMode.type : params.get('type') as EnquiryType | null;
  const [type, setType] = useState<EnquiryType>(requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general');
  useEffect(() => { setType(requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general'); }, [requestedType]);
  const vehicleId = testMode ? testMode.vehicle?.id ?? null : params.get('vehicleId');
  const vehicle:Car|undefined = testMode?.vehicle ? {...testMode.vehicle,advertId:'',images:[],make:null,model:null,variant:null,trim:null,year:null,mileage:null,mileageText:null,fuel:null,transmission:null,currency:'GBP',priceType:null,registrationBand:null,plate:null,vrm:null,vrmVerified:null,bodyType:null,engineSize:null,engineCC:null,doors:null,seats:null,colour:null,emissionClass:null,drivetrain:null,owners:null,writeOffCategory:null,advertUrl:null,dealerName:null,dealerLocation:null,imageCount:null,heroImage:null,specifications:null,sourceExtras:null} : testMode ? undefined : stock?.cars.find((car) => car.id === vehicleId);
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
        { label: vehicleRegistration(vehicle) ? 'Year & registration' : 'Year', value: customerRegistrationDetails(vehicle) },
        { label: 'Mileage', value: vehicle.mileage != null ? formatMileage(vehicle.mileage) : vehicle.mileageText },
        { label: 'Fuel', value: vehicle.fuel },
        { label: 'Gearbox', value: vehicle.transmission },
      ].filter((highlight): highlight is { label: string; value: string } => Boolean(highlight.value))
    : [];
  const changeCar = () => navigateToHomeTarget('stock', location, setLocation);

  if (type === 'viewing') return testMode ? <div onClickCapture={event=>{if((event.target as Element).closest('a')){event.preventDefault();event.stopPropagation();}}}><TestDriveBooking vehicle={vehicle} stockCars={vehicle?[vehicle]:[]} testMode={testMode} /></div> : <TestDriveBooking vehicle={vehicle} stockCars={stock?.cars ?? []} isLoading={isLoading} error={error} missingVehicle={Boolean(vehicleId && !vehicle)} />;

  return (
    <div className="friendly-page friendly-enquire luxxy-shell min-h-screen bg-background pb-20 pt-4 sm:pt-8 md:pt-12" onClickCapture={testMode ? event=>{if((event.target as Element).closest('a')){event.preventDefault();event.stopPropagation();}} : undefined}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        {!testMode && <Link
          href="/"
          className="inline-flex min-h-11 items-center gap-3 font-display text-[12px] font-normal text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          Back to showroom
        </Link>}
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
                  <li><span className="mr-3 text-accent">02</span>Your next car</li>
                  <li><span className="mr-3 text-accent">03</span>Contact details and review</li>
                </ol>
                <p className="text-xs">Have photos ready to attach in the WhatsApp chat. No obligation to proceed.</p>
              </div>
            ) : vehicle ? (
              <div className="mt-5 hidden flex-col gap-4 lg:flex" data-testid="enquiry-vehicle-summary">
                <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                  <p className="font-display text-[13px] font-semibold text-primary">Your selected car</p>
                  {!testMode && <Link href="/stock" onClick={(event) => { event.preventDefault(); changeCar(); }} className="inline-flex min-h-11 shrink-0 items-center font-display text-xs text-accent underline underline-offset-4 transition-colors hover:text-primary">
                    Change car
                  </Link>}
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
              <div className="mt-5 hidden flex-col gap-3 border-t border-border pt-5 lg:flex" data-testid="enquiry-no-vehicle-summary">
                <div>
                  <p className="mt-2 text-[12px] font-normal leading-relaxed text-primary/70">
                    If you have a specific car in mind, choose it from our stock and we’ll include it with your enquiry.
                  </p>
                </div>
                {!testMode && <Link
                  href="/stock"
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    event.preventDefault();
                    navigateToHomeTarget('stock', location, setLocation);
                  }}
                  className="font-display text-[12px] font-semibold tracking-normal text-accent transition-colors hover:text-primary mt-2 flex items-center gap-2"
                >
                  Browse our cars <ArrowRight className="h-3 w-3" />
                </Link>}
              </div>
            )}
          </section>

          <section className="min-w-0" aria-labelledby="enquiry-form-heading">
            <div className="enquiry-form-panel">
              {!testMode && isLoading ? (
                <div className="space-y-6 py-12" data-testid="loading-enquiry-vehicle">
                  <div className="h-4 w-44 animate-pulse bg-primary/20 border border-primary" />
                  <div className="h-12 w-3/4 animate-pulse bg-primary/20 border border-primary" />
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="h-16 animate-pulse bg-primary/10 border border-primary" />
                    <div className="h-16 animate-pulse bg-primary/10 border border-primary" />
                  </div>
                  <div className="h-32 animate-pulse bg-primary/10 border border-primary" />
                </div>
              ) : !testMode && error ? (
                <div className="flex items-start gap-4 border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/10 p-6 text-[13px] font-normal leading-relaxed text-primary" role="alert" data-testid="status-stock-error">
                  <CircleAlert className="h-6 w-6 shrink-0 text-[hsl(var(--accent))]" />
                  <div>
                    <p className="font-display text-[14px] font-semibold text-[hsl(var(--accent))]">We couldn’t load our current stock.</p>
                    <p className="mt-2 text-primary/70">{type === 'part_exchange' ? 'Please reload to choose a current stock vehicle, or call us.' : 'You can still send us an enquiry. Tell us which car you mean and we’ll help.'}</p>
                  </div>
                </div>
              ) : vehicleId && !vehicle ? (
                <div className="mb-10 flex items-start gap-4 border border-accent/50 bg-accent/10 p-6 text-[13px] font-normal leading-relaxed text-primary" role="alert" data-testid="status-vehicle-unavailable">
                  <CircleAlert className="h-6 w-6 shrink-0 text-accent" />
                  <div>
                    <p className="font-display text-[14px] font-semibold text-accent">This car is no longer in our current stock.</p>
                    <p className="mt-2 text-primary/70">{type === 'part_exchange' ? 'Choose another available vehicle in the Your next car step.' : 'You can still send us a general enquiry below and we’ll help you look for an alternative.'}</p>
                  </div>
                </div>
              ) : null}

              {testMode && type==='part_exchange' ? <PartExchangeForm vehicle={vehicle} stockCars={vehicle?[vehicle]:[]} testMode={{customer:testMode.customer,config:testMode.config,submit:async input=>{await testMode.submit(input);}}}/> : <EnquiryForm initialMessage={type === "general" && params.get("searchRequest") ? params.get("searchRequest")!.slice(0, 500) : vehicle && type === "general" ? questionMessage(params.get("question")) : ""} onTypeChange={setType} onChangeCar={changeCar} initialType={type} vehicle={vehicle} stockCars={stock?.cars ?? []} testMode={testMode ? {customer:testMode.customer,config:testMode.config,submit:async input=>{await testMode.submit(input);}} : undefined} />}
            </div>

            {!testMode && dealerConfig.contact.phone && <p className="mt-5 text-sm text-muted-foreground">
              Prefer to talk? {vehicle ? <VehicleCall car={vehicle} className="inline-flex min-h-11 items-center gap-2 align-middle text-primary underline underline-offset-4" /> : <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>Call Us</a>}.
            </p>}


          </section>
        </div>
      </div>
    </div>
  );
}
