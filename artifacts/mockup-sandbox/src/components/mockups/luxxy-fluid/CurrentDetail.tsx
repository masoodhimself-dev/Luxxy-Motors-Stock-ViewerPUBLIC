import type { MouseEvent } from 'react';
import { ArrowLeft, ArrowRight, MessageCircle, Phone, Calendar, Info } from 'lucide-react';
import { CarCard } from './_shared/CarCard';
import { Gallery } from './_shared/Gallery';
import { Plate } from './_shared/Plate';
import { Button } from './_shared/button';
import { Chrome } from './_shared/Chrome';
import { MockLink } from './_shared/Link';
import {
  Car,
  dealerConfig,
  formatMileage,
  formatPrice,
  getPhoneHref,
  getVehicleBookingHref,
  getVehicleWhatsAppHref,
  isUKNumberPlate,
  recordBookingIntent,
  recordContactIntent,
  scrollToHomeTarget,
  stock,
  vehicleDisplayTitle,
  vehicleRegistration,
} from './_data';

import './_group.css';

const DETAIL_CAR_ID = '0781ad32-ee31-4b5a-98f4-a900a87104ad';

function getSimilarCars(currentCar: Car, cars: Car[]) {
  const priceRange = currentCar.price ? Math.max(2500, currentCar.price * 0.25) : null;

  return cars
    .filter((candidate) => candidate.id !== currentCar.id)
    .map((candidate) => {
      let score = 0;
      const priceDistance =
        currentCar.price != null && candidate.price != null
          ? Math.abs(currentCar.price - candidate.price)
          : Number.MAX_SAFE_INTEGER;

      if (currentCar.make && candidate.make === currentCar.make) score += 5;
      if (currentCar.model && candidate.model === currentCar.model) score += 5;
      if (currentCar.bodyType && candidate.bodyType === currentCar.bodyType) score += 3;
      if (currentCar.fuel && candidate.fuel === currentCar.fuel) score += 2;
      if (currentCar.transmission && candidate.transmission === currentCar.transmission) score += 2;
      if (currentCar.year != null && candidate.year != null && Math.abs(currentCar.year - candidate.year) <= 2) score += 1;
      if (priceRange != null && candidate.price != null && priceDistance <= priceRange) score += 2;

      return { candidate, score, priceDistance };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.priceDistance - right.priceDistance;
    })
    .slice(0, 4)
    .map(({ candidate }) => candidate);
}

function LedgerRow({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-4 py-4 border-b-2 border-primary/10">
      <dt className="font-display text-[12px] font-bold uppercase tracking-widest text-primary/60">{label}</dt>
      <dd className="font-bold text-[14px] text-primary text-right" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

export default function CurrentDetail() {
  const car = stock.cars.find((candidate) => candidate.id === DETAIL_CAR_ID);
  if (!car) {
    return (
      <Chrome currentPath={`/vehicle/${DETAIL_CAR_ID}`}>
        <div className="luxxy-shell min-h-[70vh] bg-background p-12">
          <h1 className="heading-2 text-primary">Vehicle unavailable</h1>
        </div>
      </Chrome>
    );
  }

  const similarCars = getSimilarCars(car, stock.cars);
  const registration = vehicleRegistration(car);
  const registrationBand = [car.registrationBand, car.registration]
    .map((value) => value?.trim() || '')
    .find((value) => value && !isUKNumberPlate(value));
  const registrationYear = registrationBand || (car.year ? String(car.year) : 'Unknown');
  const bookingHref = getVehicleBookingHref(car);
  const phoneHref = getPhoneHref();
  const whatsappHref = getVehicleWhatsAppHref(car, 'get more information about this vehicle');
  const vehicleLabel = vehicleDisplayTitle(car);
  const photoCount = car.imageCount || car.images?.length || (car.heroImage ? 1 : 0);

  const overviewSpecs = [
    { label: 'Body Type', value: car.bodyType || '-' },
    { label: 'Doors', value: car.doors ? String(car.doors) : '-' },
    { label: 'Seats', value: car.seats ? String(car.seats) : '-' },
    { label: 'Colour', value: car.colour || '-' },
    { label: 'Drivetrain', value: car.drivetrain || '-' },
    { label: 'Emissions', value: car.emissionClass || '-' },
  ];

  const keyFacts: { label: string; value: string; testId?: string }[] = [
    { label: 'Reg Year', value: registrationYear, testId: 'text-registration-year' },
    { label: 'Mileage', value: car.mileage ? formatMileage(car.mileage) : (car.mileageText || 'Unknown') },
    {
      label: 'Fuel/Engine',
      value: `${car.fuel || '-'} • ${car.engineSize || (car.engineCC ? `${(car.engineCC / 1000).toFixed(1)}L` : '-')}`,
    },
    { label: 'Transmission', value: car.transmission || '-' },
  ];

  const damageDisclosure = (() => {
    const category = (car.writeOffCategory || '').toUpperCase();
    if (category.includes('S')) {
      return {
        label: 'Category S',
        explanation:
          'This vehicle previously had structural damage recorded by an insurer and has since been repaired. Ask us for the available repair and inspection details.',
      };
    }
    if (category.includes('N')) {
      return {
        label: 'Category N',
        explanation:
          'This vehicle previously had non-structural damage recorded by an insurer and has since been repaired. Ask us for the available repair and inspection details.',
      };
    }
    return null;
  })();

  return (
    <Chrome currentPath={`/vehicle/${DETAIL_CAR_ID}`}>
      <div className="luxxy-shell min-h-screen pb-20 lg:pb-0 bg-background">
      <div className="border-b-4 border-primary bg-background/95 backdrop-blur-sm sticky top-[calc(var(--site-header-height))] z-40">
        <div className="container mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-8">
          <MockLink
            href="/#stock"
            className="inline-flex items-center gap-3 py-4 sm:py-5 font-display text-[12px] font-bold uppercase tracking-[0.2em] text-primary transition-colors hover:text-accent group"
          >
            <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
            Back to showroom
          </MockLink>
        </div>
      </div>

      <div className="container mx-auto max-w-[90rem] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <div className="grid min-w-0 grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1.2fr)_400px] xl:grid-cols-[minmax(0,1.4fr)_460px] lg:items-start lg:gap-14 xl:gap-20">
          
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <div className="border-4 border-primary p-2 bg-background shadow-[8px_8px_0px_hsl(var(--primary))]">
               <Gallery images={car.images || []} heroImage={car.heroImage} />
            </div>
          </div>

          {/* Right Column: Key Details & CTA */}
          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 flex flex-col bg-background border-4 border-primary p-6 sm:p-8 lg:p-10 shadow-[8px_8px_0px_hsl(var(--primary))]">
            <div className="mb-8 border-b-4 border-primary pb-8">
              <h1 className="font-display text-4xl sm:text-5xl font-black uppercase tracking-tighter text-primary leading-[0.9]">
                {vehicleLabel}
              </h1>
              {(car.variant || car.trim) && (
                <p className="mt-4 font-bold text-sm uppercase tracking-widest text-primary/70">
                  {car.variant || car.trim}
                </p>
              )}
            </div>

            <div className="mb-10 flex flex-wrap items-baseline gap-4 border-b-2 border-primary/20 pb-8">
              <p className="font-display text-[3.5rem] sm:text-[4.5rem] font-black leading-none tracking-tighter text-primary">
                {car.price ? formatPrice(car.price, car.currency) : 'POA'}
              </p>
              {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
                <span className="font-display text-sm font-bold uppercase tracking-widest text-primary/50">
                  {car.priceType}
                </span>
              )}
            </div>

            {registration && (
              <div className="mb-10">
                <Plate
                  size="sm"
                  value={registration}
                  testId={`plate-vehicle-${car.id}`}
                  className="w-[140px]"
                 />
              </div>
            )}

            <div className="mb-12">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-2 w-8 bg-accent" />
                <h3 className="font-display text-[15px] font-black uppercase tracking-[0.2em] text-primary">Overview</h3>
              </div>
              <dl className="grid gap-y-0">
                <LedgerRow label="Photos" value={photoCount > 0 ? `${photoCount} available` : 'To follow'} />
                {keyFacts.map((fact) => (
                  <LedgerRow key={fact.label} label={fact.label} value={fact.value} testId={fact.testId} />
                ))}
              </dl>
            </div>

            <div className="mb-10 hidden flex-col gap-4 sm:flex lg:flex">
              <Button asChild size="lg" className="h-16 rounded-none bg-primary font-display text-[15px] font-bold uppercase tracking-[0.15em] text-primary-foreground shadow-[6px_6px_0px_hsl(var(--accent))] transition-all hover:bg-accent hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_hsl(var(--accent))] active:shadow-none">
                <a
                   href={bookingHref}
                    onClick={(event) => { event.preventDefault(); recordBookingIntent({ source: 'car_detail', vehicleContext: true }); }}
                   target={bookingHref.startsWith('https://') ? '_blank' : undefined}
                   rel={bookingHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
                  data-vehicle-contact="booking"
                >
                  <Calendar className="mr-3 h-5 w-5" />
                  {dealerConfig.bookViewing.ctaLabel}
                </a>
              </Button>
              <div className="grid grid-cols-2 gap-4">
                {phoneHref && (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="h-16 rounded-none border-2 border-primary bg-background font-display text-[13px] font-bold uppercase tracking-widest text-primary shadow-[4px_4px_0px_hsl(var(--primary))] transition-all hover:bg-primary hover:text-primary-foreground hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[1px_1px_0px_hsl(var(--primary))]"
                  >
                    <a
                      href={phoneHref}
                      aria-label={`Call about ${vehicleLabel}`}
                       onClick={(event) => { event.preventDefault(); recordContactIntent({ channel: 'call', car, source: 'car-detail' }); }}
                      data-vehicle-contact="call"
                    >
                      <Phone className="mr-3 h-4 w-4 text-accent" />
                      Call
                    </a>
                  </Button>
                )}
                {whatsappHref && (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                     className="h-16 rounded-none border-2 border-[#25D366] bg-background font-display text-[13px] font-bold uppercase tracking-widest text-[#25D366] shadow-[4px_4px_0px_#25D366] transition-all hover:bg-[#25D366] hover:text-white hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[1px_1px_0px_#25D366]"
                  >
                    <a
                      href={whatsappHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`WhatsApp about ${vehicleLabel}`}
                       onClick={(event) => { event.preventDefault(); recordContactIntent({ channel: 'whatsapp', car, source: 'car-detail' }); }}
                      data-vehicle-contact="whatsapp"
                    >
                      <MessageCircle className="mr-3 h-5 w-5" />
                      Msg
                    </a>
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-auto pt-8 font-display text-[11px] font-bold uppercase tracking-widest leading-relaxed text-primary/50 border-t-2 border-primary/10">
              <p>
                SOLD BY <strong className="font-black text-primary">{dealerConfig.identity.name || stock.dealerName || 'Independent Dealer'}</strong>. VIEWINGS BY APPOINTMENT.
              </p>
            </div>
          </div>

          <section
            className="border-t-4 border-primary pt-12 lg:col-start-1 lg:row-start-2 mt-8"
            aria-labelledby="vehicle-overview-heading"
          >
            <div className="flex items-center gap-4 mb-10">
              <div className="h-3 w-12 bg-accent" />
              <h2 id="vehicle-overview-heading" className="font-display text-3xl font-black uppercase tracking-tighter text-primary">
                Technical Data
              </h2>
            </div>
            <dl className="grid gap-x-16 sm:grid-cols-2 bg-background border-2 border-primary p-8 shadow-[4px_4px_0px_hsl(var(--primary))]">
              {overviewSpecs.map((spec) => (
                <LedgerRow key={spec.label} label={spec.label} value={spec.value} />
              ))}
            </dl>
            {damageDisclosure && (
              <div className="mt-12 border-4 border-accent p-6 bg-accent/5">
                <div className="flex items-center gap-3 mb-4">
                  <Info className="h-6 w-6 text-accent" />
                  <p className="font-display text-lg font-black uppercase tracking-wider text-primary">
                    Insurance Note: {damageDisclosure.label}
                  </p>
                </div>
                <p className="text-sm font-bold leading-relaxed text-primary/80 uppercase tracking-wide">
                  {damageDisclosure.explanation}
                </p>
              </div>
            )}
          </section>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[1fr_auto] gap-2 border-t-4 border-primary bg-background p-3 lg:hidden" data-testid="mobile-conversion-bar">
          <Button asChild className="h-14 rounded-none font-display text-[13px] font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-accent shadow-[3px_3px_0px_hsl(var(--primary))]">
             <a href={bookingHref} onClick={(event) => { event.preventDefault(); recordBookingIntent({ source: 'car_detail_mobile', vehicleContext: true }); }}><Calendar className="mr-2 h-4 w-4" />{dealerConfig.bookViewing.ctaLabel}</a>
          </Button>
          {phoneHref && (
            <Button asChild variant="outline" size="icon" className="h-14 w-14 rounded-none border-2 border-primary text-accent hover:bg-primary hover:text-primary-foreground bg-background shadow-[3px_3px_0px_hsl(var(--primary))]">
               <a href={phoneHref} onClick={(event) => { event.preventDefault(); recordContactIntent({ channel: 'call', car, source: 'car-detail-mobile' }); }}><Phone className="h-5 w-5" /></a>
            </Button>
          )}
        </div>
      </div>

      {similarCars.length > 0 && (
        <section className="bg-primary py-24 text-primary-foreground border-t-8 border-accent relative overflow-hidden" aria-labelledby="similar-cars-heading">
          <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none">
             <span className="font-display text-[20rem] font-black leading-none">MORE</span>
          </div>
          <div className="container mx-auto max-w-[90rem] px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="mb-16 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between border-b-2 border-primary-foreground/20 pb-10">
              <div>
                <p className="font-display text-sm font-black uppercase tracking-[0.2em] text-accent mb-4">Alternatives</p>
                <h2
                  id="similar-cars-heading"
                  className="heading-2 text-primary-foreground"
                >
                  SIMILAR VEHICLES
                </h2>
                <p className="mt-6 max-w-xl font-bold uppercase tracking-wide text-primary-foreground/70">
                  A few other vehicles from our current stock that may suit what you're looking for.
                </p>
              </div>
              <MockLink
                href="/#stock"
                onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                  event.preventDefault();
                  scrollToHomeTarget('stock');
                }}
                className="shrink-0 font-display text-[13px] font-bold uppercase tracking-[0.2em] text-accent transition-colors hover:text-primary-foreground pb-1 flex items-center gap-2 group"
              >
                View all stock <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </MockLink>
            </div>
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-4 xl:gap-10">
              {similarCars.map((similarCar) => (
                <CarCard key={similarCar.id} car={similarCar} stretchedLink analyticsSource="similar_cars" />
              ))}
            </div>
          </div>
        </section>
      )}
      </div>
    </Chrome>
  );
}