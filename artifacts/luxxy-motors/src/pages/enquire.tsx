import { customerDefaultCopy, websiteText } from "@/lib/website-content";
import { vehicleDetailPath } from '@workspace/vehicle-meta';
import './customer-workflows.css';
import { questionMessage } from "@/lib/vehicle-questions";
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Camera, CircleAlert } from '@/components/icons';
import { Link, useLocation, useSearch } from 'wouter';
import { EnquiryForm } from '@/components/enquiry-form';
import { EnquiryCarPicker } from '@/components/enquiry-car-picker';
import { VehicleCall } from '@/components/vehicle-call';
import { TestDriveBooking } from '@/components/test-drive-booking';
import { useStock, type Car } from '@/lib/stock-context';
import type { EnquiryType } from '@/lib/cta-helpers';
import { formatMileage, formatPrice, getThumbnailUrl, vehicleRegistration } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { usePageMeta } from '@/hooks/use-page-meta';
import { enquiryPageMeta } from '@/lib/page-meta';

const enquiryTypes: EnquiryType[] = ['viewing', 'general', 'part_exchange'];
const metaHeadings: Record<EnquiryType, string> = {
  viewing: 'Book a Test Drive',
  general: 'Contact us',
  part_exchange: 'Part-exchange enquiry',
};

function vehicleName(vehicle: { title: string | null; make: string | null; model: string | null }) {
  return vehicle.title || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Selected vehicle';
}

export default function Enquire() {
  const [, setLocation] = useLocation();
  const { stock, isLoading, error } = useStock();
  const { settings: dealerConfig } = useDealerSettings();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const requestedType = params.get('type') as EnquiryType | null;
  const [type, setType] = useState<EnquiryType>(requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general');
  useEffect(() => { setType(requestedType && enquiryTypes.includes(requestedType) ? requestedType : 'general'); }, [requestedType]);
  const vehicleId = params.get('vehicleId');
  const [carPickerOpen, setCarPickerOpen] = useState(false);
  const [carryDraftToVehicleId, setCarryDraftToVehicleId] = useState<string>();
  const [formBusy, setFormBusy] = useState(false);
  const vehicle = stock?.cars.find((car) => car.id === vehicleId);
  const waitingForStock = isLoading && !stock;
  const waitingForSelectedCar = waitingForStock && Boolean(vehicleId);
  const requestedMessage = type === 'general' ? params.get('searchRequest')?.trim().slice(0, 500) : undefined;
  const isCarMessage = type === 'general' && Boolean(vehicle);
  const title = websiteText(dealerConfig, `${type}Title`);
  const description = websiteText(dealerConfig, `${type}Description`);
  const isPartExchange = type === 'part_exchange';
  const copy = {
    title: isPartExchange
      ? customerDefaultCopy(title, 'Get a part-exchange quote', ['Part-exchange your car'])
      : customerDefaultCopy(title, isCarMessage ? 'Ask about this car' : 'Message the showroom', ['How can we help?']),
    description: customerDefaultCopy(description, '', [
      'Tell us what you’d like to know. We’ll get back to you.',
      'Tell us about your car and ask about your part-exchange options.',
    ]),
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
  const changeCar = () => { if (!formBusy) setCarPickerOpen(true); };
  const selectCar = (car: Car, carryCurrent: boolean) => {
    if (formBusy) return;
    setCarryDraftToVehicleId(carryCurrent ? car.id : undefined);
    setCarPickerOpen(false);
    const next = new URLSearchParams(params);
    next.set('vehicleId', car.id);
    // Old advert prompts must not be re-applied to a different vehicle.
    next.delete('question');
    next.delete('searchRequest');
    setLocation(`/enquire?${next.toString()}`, { replace: true });
  };

  if (type === 'viewing') return <TestDriveBooking vehicle={vehicle} stockCars={stock?.cars ?? []} isLoading={isLoading} error={error} missingVehicle={Boolean(vehicleId && !vehicle)} />;

  return (
    <div className={`friendly-page friendly-enquire luxxy-shell min-h-screen bg-background pb-20 pt-4 sm:pt-8 md:pt-12 ${isPartExchange ? 'friendly-part-exchange' : 'friendly-message'}`}>
      <div className="container enquiry-page-container mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          href={isCarMessage ? vehicleDetailPath(vehicle!) : '/'}
          className="enquiry-back-link inline-flex min-h-11 items-center gap-3 font-display text-[12px] font-normal text-primary transition-colors hover:text-accent group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          {isCarMessage ? 'Back to car' : 'Back to showroom'}
        </Link>
        <div className="enquiry-page-layout mt-3 grid items-start gap-5 sm:mt-5 sm:gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:gap-12">
          <section className="enquiry-introduction flex flex-col">
            <div className="friendly-banner">
              <h1 className="heading-2 text-primary">{copy.title}</h1>
              {copy.description && <p className="mt-3 text-sm font-normal leading-relaxed text-primary/70 sm:mt-6 sm:text-[15px]">{copy.description}</p>}
            </div>

            {isPartExchange ? null : vehicle ? (
              <div className="mt-5 hidden flex-col gap-4 lg:flex" data-testid="enquiry-vehicle-summary">
                <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                  <p className="font-display text-[13px] font-semibold text-primary">Your selected car</p>
                  <button type="button" disabled={formBusy} onClick={changeCar} className="inline-flex min-h-11 shrink-0 items-center font-display text-xs text-accent underline underline-offset-4 transition-colors hover:text-primary disabled:opacity-50">
                    Change car
                  </button>
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
                    Choose a car and we’ll include it with your enquiry.
                  </p>
                </div>
                <button type="button" disabled={formBusy} onClick={changeCar} className="min-h-11 text-left text-sm text-primary underline underline-offset-4 disabled:opacity-50">Choose a car</button>
              </div>
            )}
          </section>

          <section className="min-w-0" aria-labelledby="enquiry-form-heading">
            <div className="enquiry-form-panel">
              {waitingForSelectedCar ? (
                <div className="space-y-6 py-12" data-testid="loading-enquiry-vehicle">
                  <div className="h-4 w-44 animate-pulse bg-primary/20 border border-primary" />
                  <div className="h-12 w-3/4 animate-pulse bg-primary/20 border border-primary" />
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="h-16 animate-pulse bg-primary/10 border border-primary" />
                    <div className="h-16 animate-pulse bg-primary/10 border border-primary" />
                  </div>
                  <div className="h-32 animate-pulse bg-primary/10 border border-primary" />
                </div>
              ) : error && (type === 'part_exchange' || Boolean(vehicleId)) ? (
                <div className="flex items-start gap-4 border border-[hsl(var(--accent))]/50 bg-[hsl(var(--accent))]/10 p-6 text-[13px] font-normal leading-relaxed text-primary" role="alert" data-testid="status-stock-error">
                  <CircleAlert className="h-6 w-6 shrink-0 text-[hsl(var(--accent))]" />
                  <div>
                    <p className="font-display text-[14px] font-semibold text-[hsl(var(--accent))]">We couldn’t load our current stock.</p>
                    <p className="mt-2 text-primary/70">{type === 'part_exchange' ? 'You can still send a part-exchange enquiry without choosing another car.' : 'You can still send us an enquiry. Tell us which car you mean and we’ll help.'}</p>
                  </div>
                </div>
              ) : vehicleId && !vehicle ? (
                <div className="mb-10 flex items-start gap-4 border border-accent/50 bg-accent/10 p-6 text-[13px] font-normal leading-relaxed text-primary" role="alert" data-testid="status-vehicle-unavailable">
                  <CircleAlert className="h-6 w-6 shrink-0 text-accent" />
                  <div>
                    <p className="font-display text-[14px] font-semibold text-accent">This car is no longer in our current stock.</p>
                    <p className="mt-2 text-primary/70">{type === 'part_exchange' ? 'You can choose another car or continue without choosing one.' : 'You can still send us a general enquiry below and we’ll help you look for an alternative.'}</p>
                  </div>
                </div>
              ) : null}

              {!waitingForSelectedCar && <EnquiryForm
                key={type === 'general' ? type : `${type}:${vehicle?.id ?? 'general'}`}
                initialMessage={!requestedMessage && vehicle && type === 'general' ? questionMessage(params.get('question')) : ''}
                messageRequest={requestedMessage ? { id: `link:${requestedMessage}`, text: requestedMessage } : undefined}
                onTypeChange={setType}
                onChangeCar={changeCar}
                onBusyChange={setFormBusy}
                carryDraftToVehicleId={carryDraftToVehicleId}
                initialType={type}
                vehicle={vehicle}
                stockCars={stock?.cars ?? []}
              />}
            </div>

            {dealerConfig.contact.phone && <p className="mt-5 text-sm text-muted-foreground">
              Prefer to talk? {vehicle ? <VehicleCall car={vehicle} className="inline-flex min-h-11 items-center gap-2 align-middle text-primary underline underline-offset-4" /> : <a className="inline-flex min-h-11 items-center text-primary underline underline-offset-4" href={`tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`}>Call Us</a>}.
            </p>}


          </section>
        </div>
      </div>
      <EnquiryCarPicker open={carPickerOpen} onOpenChange={setCarPickerOpen} cars={stock?.cars ?? []} currentId={vehicle?.id} onSelect={selectCar} />
    </div>
  );
}
