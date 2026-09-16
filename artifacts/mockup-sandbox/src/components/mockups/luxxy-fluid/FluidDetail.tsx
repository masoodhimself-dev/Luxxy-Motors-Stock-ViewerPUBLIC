import { useState } from 'react';
import { ChevronLeft, ChevronRight, Heart, Share2, Calendar, Phone, MessageCircle, MapPin, Scale } from 'lucide-react';
import { FluidButton } from './_fluid-Button';
import { FluidChrome } from './_fluid-Chrome';
import { FluidCarCard } from './_fluid-CarCard';
import { MockLink } from './_shared/Link';
import { Plate } from './_shared/Plate';
import {
  Car,
  cn,
  dealerConfig,
  formatMileage,
  formatPrice,
  getSafeImageUrl,
  isUKNumberPlate,
  stock,
  vehicleDisplayTitle,
  vehicleRegistration,
} from './_data';
import './_fluid-theme.css';

const DETAIL_CAR_ID = '0781ad32-ee31-4b5a-98f4-a900a87104ad';

function FluidGallery({ images, heroImage }: { images: Car['images'], heroImage: string | null }) {
  const allImages = [getSafeImageUrl(heroImage), ...(images || []).map(getSafeImageUrl)].filter(Boolean) as string[];
  const [currentIndex, setCurrentIndex] = useState(0);

  if (allImages.length === 0) {
    return <div className="aspect-[4/3] bg-secondary rounded-3xl flex items-center justify-center">No Images</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[4/3] sm:aspect-[16/10] lg:aspect-[4/3] xl:aspect-[16/10] overflow-hidden rounded-3xl bg-secondary isolate">
        <img 
          src={allImages[currentIndex]} 
          alt="Vehicle" 
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
        />
        
        {allImages.length > 1 && (
          <>
            <button 
              onClick={() => setCurrentIndex((c) => (c - 1 + allImages.length) % allImages.length)}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur text-foreground flex items-center justify-center hover:bg-background hover:scale-105 transition-all shadow-sm focus-ring"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setCurrentIndex((c) => (c + 1) % allImages.length)}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-background/80 backdrop-blur text-foreground flex items-center justify-center hover:bg-background hover:scale-105 transition-all shadow-sm focus-ring"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}
      </div>

      {allImages.length > 1 && (
        <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
          {allImages.map((src, i) => (
            <button 
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={cn("relative flex-shrink-0 w-24 h-16 sm:w-32 sm:h-20 rounded-xl overflow-hidden snap-center focus-ring transition-all", currentIndex === i ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : "opacity-60 hover:opacity-100")}
            >
              <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FluidDetail() {
  const car = stock.cars.find(c => c.id === DETAIL_CAR_ID);
  const [saved, setSaved] = useState(false);

  if (!car) {
    return (
      <FluidChrome currentPath={`/vehicle/${DETAIL_CAR_ID}`}>
        <div className="container mx-auto px-4 py-12">Vehicle unavailable</div>
      </FluidChrome>
    );
  }

  const registration = vehicleRegistration(car);
  const registrationBand = [car.registrationBand, car.registration]
    .map((value) => value?.trim() || '')
    .find((value) => value && !isUKNumberPlate(value));
  const registrationYear = registrationBand || (car.year ? String(car.year) : 'Unknown');
  const vehicleLabel = vehicleDisplayTitle(car);

  const overviewSpecs = [
    { label: 'Year', value: registrationYear },
    { label: 'Mileage', value: car.mileage ? formatMileage(car.mileage) : (car.mileageText || 'Unknown') },
    { label: 'Fuel', value: car.fuel || '-' },
    { label: 'Transmission', value: car.transmission || '-' },
    { label: 'Body Type', value: car.bodyType || '-' },
    { label: 'Engine', value: car.engineSize || (car.engineCC ? `${(car.engineCC / 1000).toFixed(1)}L` : '-') },
    { label: 'Colour', value: car.colour || '-' },
    { label: 'Emissions', value: car.emissionClass || '-' },
  ];

  return (
    <FluidChrome currentPath={`/vehicle/${DETAIL_CAR_ID}`}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
        {/* Breadcrumb & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <MockLink href="/#inventory" className="text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-1.5 focus-ring rounded-lg p-1 -ml-1 transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back to Inventory
          </MockLink>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl hover:bg-secondary/80 transition-colors focus-ring">
              <Share2 className="w-4 h-4 text-muted-foreground" /> Share
            </button>
            <button className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl hover:bg-secondary/80 transition-colors focus-ring">
              <Scale className="w-4 h-4 text-muted-foreground" /> Compare
            </button>
            <button onClick={() => setSaved(!saved)} className={cn("flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-xl transition-colors focus-ring", saved ? "bg-accent/10 text-accent" : "hover:bg-secondary/80")}>
              <Heart className={cn("w-4 h-4", saved && "fill-current")} /> {saved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.3fr_400px] xl:grid-cols-[1.5fr_440px] gap-12 lg:gap-16 items-start">
          
          {/* Left Column: Gallery & Details */}
          <div className="min-w-0">
            {/* Mobile Title & Price */}
            <div className="lg:hidden mb-6">
              <h1 className="text-3xl font-semibold tracking-tight leading-[1.1] mb-2">{vehicleLabel}</h1>
              {(car.variant || car.trim) && (
                <p className="text-muted-foreground mb-4">{car.variant || car.trim}</p>
              )}
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight">{car.price ? formatPrice(car.price, car.currency) : 'POA'}</span>
                {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
                  <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{car.priceType}</span>
                )}
              </div>
            </div>

            <FluidGallery images={car.images || []} heroImage={car.heroImage} />

            <div className="mt-12 sm:mt-16">
              <h2 className="text-2xl font-semibold tracking-tight mb-8">Vehicle Specifications</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {overviewSpecs.map(spec => (
                  <div key={spec.label} className="flex justify-between items-center py-4 border-b border-border/40">
                    <span className="text-muted-foreground font-medium">{spec.label}</span>
                    <span className="font-semibold">{spec.value}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="mt-16 p-8 bg-secondary/30 rounded-3xl border border-border/50">
              <h3 className="text-xl font-semibold tracking-tight mb-4">Dealer Notes</h3>
              <div className="prose prose-sm sm:prose-base prose-neutral max-w-none text-muted-foreground">
                <p>Exceptional condition throughout. Full main dealer service history. Includes 12 months comprehensive warranty and recent multi-point inspection.</p>
                <p>Viewing by appointment highly recommended to fully appreciate the condition and specification of this vehicle.</p>
              </div>
            </div>
          </div>

          {/* Right Column: Sticky Sticky CTA */}
          <div className="lg:sticky lg:top-[calc(var(--site-header-height,5.5rem)+2rem)] flex flex-col gap-6">
            <div className="bg-background rounded-3xl p-6 sm:p-8 border border-border/60 soft-shadow">
              <div className="hidden lg:block">
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-[1.1] mb-2">{vehicleLabel}</h1>
                {(car.variant || car.trim) && (
                  <p className="text-muted-foreground text-lg mb-8">{car.variant || car.trim}</p>
                )}
                
                <div className="flex items-baseline gap-3 mb-8">
                  <span className="text-4xl sm:text-5xl font-bold tracking-tight">{car.price ? formatPrice(car.price, car.currency) : 'POA'}</span>
                  {car.priceType && car.priceType.toLowerCase() !== 'cash' && (
                    <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">{car.priceType}</span>
                  )}
                </div>
              </div>

              {registration && (
                <div className="mb-8">
                  <Plate testId="fluid-detail-registration" size="sm" value={registration} className="w-[140px]" />
                </div>
              )}

              <div className="flex flex-col gap-3">
                <FluidButton size="lg" className="w-full" onClick={() => alert('Booking preview only')}>
                  <Calendar className="w-5 h-5 mr-2" /> Book a Viewing
                </FluidButton>
                <div className="grid grid-cols-2 gap-3">
                  <FluidButton variant="outline" className="w-full">
                    <Phone className="w-4 h-4 mr-2" /> Call
                  </FluidButton>
                  <FluidButton variant="outline" className="w-full text-[#25D366] hover:bg-[#25D366]/10 hover:text-[#25D366] border-[#25D366]/30">
                    <MessageCircle className="w-4 h-4 mr-2" /> WhatsApp
                  </FluidButton>
                </div>
              </div>
              
              <div className="mt-8 pt-6 border-t border-border/40 text-sm text-muted-foreground flex flex-col gap-3">
                <p className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-foreground/40" /> 
                  <span>Available at <strong>{dealerConfig.identity.name}</strong><br/>{dealerConfig.address.city}, {dealerConfig.address.region}</span>
                </p>
              </div>
            </div>
            
            {dealerConfig.partExchange?.enabled && (
              <div className="bg-secondary/30 rounded-2xl p-6 border border-border/50 flex flex-col gap-2">
                <h3 className="font-semibold text-foreground">Considering Part Exchange?</h3>
                <p className="text-sm text-muted-foreground mb-2">Get a competitive valuation for your current vehicle.</p>
                <MockLink href="/part-exchange" className="text-sm font-semibold text-accent hover:text-accent/80 transition-colors focus-ring rounded w-fit p-1 -ml-1">Value My Car &rarr;</MockLink>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Alternatives */}
      <section className="mt-12 border-t border-border/40 bg-secondary/20 py-16 sm:py-24">
        <div className="container mx-auto px-4 lg:px-8">
          <div className="flex items-end justify-between gap-6 mb-10">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight mb-2">Similar Vehicles</h2>
              <p className="text-muted-foreground">Other options you might consider</p>
            </div>
            <MockLink href="/#inventory" className="text-sm font-medium text-accent hover:text-accent/80 focus-ring rounded-lg p-1 transition-colors">
              View All &rarr;
            </MockLink>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {stock.cars.filter(c => c.id !== DETAIL_CAR_ID).slice(0, 4).map(c => (
              <FluidCarCard key={c.id} car={c} layout="card" />
            ))}
          </div>
        </div>
      </section>
      
      {/* Mobile conversion bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-xl border-t border-border/40 p-3 lg:hidden flex gap-2 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] pb-4">
        <FluidButton size="lg" className="flex-1 rounded-xl shadow-none">
          Book Viewing
        </FluidButton>
        <FluidButton variant="outline" size="icon" className="w-14 rounded-xl shrink-0">
          <Phone className="w-5 h-5" />
        </FluidButton>
      </div>
    </FluidChrome>
  );
}
