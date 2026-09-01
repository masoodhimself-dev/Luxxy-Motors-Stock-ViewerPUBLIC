import { useRoute } from 'wouter';
import { ArrowLeft, Calendar, MapPin, Fuel, Settings, Activity, ShieldCheck, Info, MessageCircle, Phone } from 'lucide-react';
import { Link } from 'wouter';
import { CarCard } from '@/components/car-card';
import { useStock, type Car } from '@/lib/stock-context';
import { Gallery } from '@/components/gallery';
import { formatPrice, formatMileage } from '@/lib/utils';
import { getPhoneHref, getVehicleBookingHref, getVehicleWhatsAppHref } from '@/lib/cta-helpers';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import NotFound from '@/pages/not-found';

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

export default function CarDetail() {
  const [, params] = useRoute('/vehicle/:id');
  const { stock, isLoading } = useStock();

  if (isLoading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="animate-pulse w-12 h-12 rounded-full bg-primary/20"></div>
      </div>
    );
  }

  if (!stock || !stock.cars) return <NotFound />;

  const car = stock.cars.find(c => c.id === params?.id);
  
  if (!car) return <NotFound />;

  const similarCars = getSimilarCars(car, stock.cars);

  const getWriteOffBadge = () => {
    if (!car.writeOffCategory) return null;
    const cat = car.writeOffCategory.toUpperCase();
    if (cat.includes('S') || cat === 'CAT S') {
      return <Badge variant="destructive" className="text-sm px-3 py-1"><Info className="w-4 h-4 mr-1"/>Cat S Damaged</Badge>;
    }
    if (cat.includes('N') || cat === 'CAT N') {
      return <Badge variant="warning" className="text-sm px-3 py-1"><Info className="w-4 h-4 mr-1"/>Cat N Damaged</Badge>;
    }
    return null;
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Showroom
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Gallery & Description */}
        <div className="lg:col-span-2 space-y-8">
          <Gallery images={car.images || []} heroImage={car.heroImage} />
          
          <div className="bg-card rounded-xl border p-6 shadow-sm">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <Activity className="text-primary w-5 h-5"/>
              Vehicle Overview
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="p-3 bg-muted/50 rounded-lg border border-border/50">
                <span className="text-muted-foreground block text-xs uppercase font-semibold mb-1">Body Type</span>
                <span className="font-medium text-foreground">{car.bodyType || '-'}</span>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg border border-border/50">
                <span className="text-muted-foreground block text-xs uppercase font-semibold mb-1">Doors</span>
                <span className="font-medium text-foreground">{car.doors || '-'}</span>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg border border-border/50">
                <span className="text-muted-foreground block text-xs uppercase font-semibold mb-1">Seats</span>
                <span className="font-medium text-foreground">{car.seats || '-'}</span>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg border border-border/50">
                <span className="text-muted-foreground block text-xs uppercase font-semibold mb-1">Colour</span>
                <span className="font-medium text-foreground">{car.colour || '-'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Key Details & CTA */}
        <div className="space-y-6">
          <div className="bg-card rounded-xl border p-6 shadow-sm sticky top-24">
            <div className="mb-2 flex items-start justify-between gap-4">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground leading-tight">
                {car.title || `${car.make} ${car.model}`}
              </h1>
            </div>
            
            <p className="text-muted-foreground font-medium mb-6">
              {car.variant || car.trim}
            </p>
            
            <div className="flex items-center gap-3 mb-6">
              <div className="text-4xl font-extrabold text-primary tracking-tighter">
                {car.price ? formatPrice(car.price, car.currency) : 'POA'}
              </div>
              {car.priceType && (
                <Badge variant="outline" className="text-xs uppercase">
                  {car.priceType}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              {car.plate || car.registration ? (
                <div className="bg-[#F8CA1C] text-black font-bold px-3 py-1 rounded uppercase tracking-widest text-sm border border-black/10 shadow-inner">
                  {car.plate || car.registration}
                </div>
              ) : null}
              {getWriteOffBadge()}
            </div>

            <div className="space-y-4 py-6 border-y mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Registration Year</p>
                  <p className="font-semibold">{car.year || 'Unknown'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Mileage</p>
                  <p className="font-semibold">{car.mileage ? formatMileage(car.mileage) : (car.mileageText || 'Unknown')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Fuel className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Fuel & Engine</p>
                  <p className="font-semibold">{car.fuel || '-'} • {car.engineSize || (car.engineCC ? `${(car.engineCC/1000).toFixed(1)}L` : '-')}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                  <Settings className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Transmission</p>
                  <p className="font-semibold">{car.transmission || '-'}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button asChild size="lg" className="col-span-2 text-base h-12 shadow-md">
                <a
                  href={getVehicleBookingHref(car)}
                  target={getVehicleBookingHref(car).startsWith('https://') ? '_blank' : undefined}
                  rel={getVehicleBookingHref(car).startsWith('https://') ? 'noopener noreferrer' : undefined}
                  data-vehicle-contact="booking"
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Book a Viewing
                </a>
              </Button>
              {getPhoneHref() && (
                <Button asChild variant="outline" size="lg" className="text-base h-12">
                  <a href={getPhoneHref()!} aria-label={`Call about ${car.title || `${car.make || ''} ${car.model || ''}`.trim()}`}>
                    <Phone className="w-4 h-4 mr-2 text-primary" />
                    Call
                  </a>
                </Button>
              )}
              {getVehicleWhatsAppHref(car, 'get more information about this vehicle') && (
                <Button asChild variant="outline" size="lg" className="text-base h-12 border-green-200 text-green-700 hover:bg-green-50">
                  <a
                    href={getVehicleWhatsAppHref(car, 'get more information about this vehicle')!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`WhatsApp about ${car.title || `${car.make || ''} ${car.model || ''}`.trim()}`}
                    data-vehicle-contact="whatsapp"
                  >
                    <MessageCircle className="w-4 h-4 mr-2" />
                    WhatsApp
                  </a>
                </Button>
              )}
            </div>
            
            <div className="mt-6 p-4 bg-muted/40 rounded-lg border flex gap-3 text-sm text-muted-foreground">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
              <p>Sold by {stock.dealerName || 'Independent Dealer'}. Viewings by appointment only.</p>
            </div>
          </div>
        </div>

      </div>

      {similarCars.length > 0 && (
        <section className="mt-14 border-t border-border/70 pt-10" aria-labelledby="similar-cars-heading">
          <div className="mb-7 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-accent">Keep exploring</p>
              <h2 id="similar-cars-heading" className="mt-1 text-3xl font-black tracking-tight text-foreground">
                Similar cars
              </h2>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                A few other vehicles from our current stock that may suit what you&apos;re looking for.
              </p>
            </div>
            <Link href="/#stock" className="text-sm font-bold text-primary transition-colors hover:text-accent">
              View all stock <span aria-hidden="true">→</span>
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
            {similarCars.map((similarCar) => (
              <CarCard key={similarCar.id} car={similarCar} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
