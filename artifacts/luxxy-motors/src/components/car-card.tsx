import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Car } from '@/lib/stock-context';
import { formatPrice, formatMileage, getSafeImageUrl, getThumbnailUrl } from '@/lib/utils';
import { getPhoneHref, getVehicleBookingHref, getVehicleWhatsAppHref } from '@/lib/cta-helpers';
import { Badge } from '@/components/ui/badge';
import { MapPin, Fuel, Settings, Calendar, AlertTriangle, ArrowRight, Camera, MessageCircle, Phone } from 'lucide-react';

export function CarCard({ car }: { car: Car }) {
  const imageUrls = useMemo(() => {
    const urls: string[] = [];
    const addImage = (image: string | { url: string; caption?: string | null } | null | undefined) => {
      const url = image ? getSafeImageUrl(image) : '';
      if (url && !urls.includes(url)) urls.push(url);
    };

    addImage(getThumbnailUrl(car));
    car.images?.forEach(addImage);
    addImage(car.heroImage);

    return urls;
  }, [car]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [failedImageUrls, setFailedImageUrls] = useState<Set<string>>(new Set());
  const visibleImageUrls = imageUrls.filter((url) => !failedImageUrls.has(url));
  const vehicleLabel = car.title || `${car.make || ''} ${car.model || ''}`.trim() || 'this vehicle';
  const phoneHref = getPhoneHref();
  const whatsappHref = getVehicleWhatsAppHref(car, 'get more information about this vehicle');
  const bookingHref = getVehicleBookingHref(car);

  useEffect(() => {
    setActiveImageIndex(0);
    setFailedImageUrls(new Set());
  }, [car.id]);

  useEffect(() => {
    if (visibleImageUrls.length < 2) return;

    const timer = window.setInterval(() => {
      setActiveImageIndex((current) => (current + 1) % visibleImageUrls.length);
    }, 3500);

    return () => window.clearInterval(timer);
  }, [visibleImageUrls.length]);

  const activeImage = visibleImageUrls.length > 0
    ? visibleImageUrls[activeImageIndex % visibleImageUrls.length]
    : '';

  const getWriteOffBadge = () => {
    if (!car.writeOffCategory) return null;
    const cat = car.writeOffCategory.toUpperCase();
    if (cat.includes('S') || cat === 'CAT S') {
      return <Badge variant="destructive" className="absolute top-3 left-3 shadow-md z-10 font-bold tracking-wide"><AlertTriangle className="w-3.5 h-3.5 mr-1.5"/>CAT S</Badge>;
    }
    if (cat.includes('N') || cat === 'CAT N') {
      return <Badge variant="warning" className="absolute top-3 left-3 shadow-md z-10 font-bold tracking-wide bg-amber-500 hover:bg-amber-600 text-black border-none"><AlertTriangle className="w-3.5 h-3.5 mr-1.5"/>CAT N</Badge>;
    }
    return null;
  };

  return (
    <div className="group bg-card rounded-xl border border-border/60 overflow-hidden h-full flex flex-col transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 hover:border-primary/30 transform hover:-translate-y-1">
        
        {/* Image Container */}
        <Link href={`/vehicle/${car.id}`} aria-label={`View details for ${vehicleLabel}`} className="relative block aspect-[3/2] bg-muted overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          {getWriteOffBadge()}
          {activeImage ? (
            visibleImageUrls.map((imageUrl, index) => (
              <img
                key={imageUrl}
                src={imageUrl}
                alt={index === (activeImageIndex % visibleImageUrls.length) ? (car.title || `${car.make} ${car.model}`) : ''}
                aria-hidden={index !== (activeImageIndex % visibleImageUrls.length)}
                loading={index === 0 ? 'eager' : 'lazy'}
                referrerPolicy="no-referrer"
                onError={() => {
                  setFailedImageUrls((current) => {
                    const next = new Set(current);
                    next.add(imageUrl);
                    return next;
                  });
                }}
                className={`absolute inset-0 object-cover w-full h-full transition-opacity duration-700 ease-out group-hover:scale-110 ${
                  index === (activeImageIndex % visibleImageUrls.length) ? 'opacity-100' : 'opacity-0'
                }`}
              />
            ))
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-secondary/50 text-sm">
              <Camera className="w-8 h-8 mb-2 opacity-50" />
              <span>Image Unavailable</span>
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

          <div className="absolute bottom-3 right-3 flex gap-2 z-10">
            {(car.imageCount || (car.images?.length)) ? (
              <Badge variant="secondary" className="bg-black/70 text-white border-white/20 backdrop-blur-md font-medium text-xs px-2 py-1 flex items-center gap-1.5">
                <Camera className="w-3 h-3" />
                {car.imageCount || car.images?.length}
              </Badge>
            ) : null}
          </div>
        </Link>

        {/* Content */}
        <Link href={`/vehicle/${car.id}`} className="p-5 flex flex-col flex-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          <div className="mb-4">
            <h3 className="font-bold text-lg lg:text-xl leading-tight text-foreground line-clamp-2 group-hover:text-primary transition-colors">
              {car.title || `${car.make} ${car.model}`}
            </h3>
            {car.variant || car.trim ? (
              <p className="text-sm text-muted-foreground line-clamp-1 mt-1 font-medium">
                {car.variant || car.trim}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm mb-6 text-muted-foreground/90 flex-1 content-start font-medium">
            {car.year && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-secondary flex items-center justify-center shrink-0">
                  <Calendar className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="truncate">{car.year}</span>
              </div>
            )}
            {(car.mileage || car.mileageText) && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-secondary flex items-center justify-center shrink-0">
                  <MapPin className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="truncate">{car.mileage ? formatMileage(car.mileage) : car.mileageText}</span>
              </div>
            )}
            {car.fuel && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-secondary flex items-center justify-center shrink-0">
                  <Fuel className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="truncate">{car.fuel}</span>
              </div>
            )}
            {car.transmission && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded bg-secondary flex items-center justify-center shrink-0">
                  <Settings className="w-3.5 h-3.5 text-primary" />
                </div>
                <span className="truncate">{car.transmission}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-4 mt-auto border-t border-border/50">
            <div className="font-bold text-2xl text-foreground tracking-tight">
              {car.price ? formatPrice(car.price, car.currency) : 'POA'}
            </div>
            <div className="w-10 h-10 rounded-full bg-primary/5 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors duration-300">
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        </Link>

        <div className="px-5 pb-5 grid grid-cols-2 gap-2">
          {phoneHref && (
            <a
              href={phoneHref}
              title={`Call about ${vehicleLabel}`}
              aria-label={`Call about ${vehicleLabel}`}
              data-vehicle-contact="call"
              className="flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Phone className="w-4 h-4 text-primary" />
              Call
            </a>
          )}
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              title={`WhatsApp about ${vehicleLabel}`}
              aria-label={`WhatsApp about ${vehicleLabel}`}
              data-vehicle-contact="whatsapp"
              className="flex items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm font-bold text-green-700 transition-colors hover:border-green-300 hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </a>
          )}
          <a
            href={bookingHref}
            target={bookingHref.startsWith('https://') ? '_blank' : undefined}
            rel={bookingHref.startsWith('https://') ? 'noopener noreferrer' : undefined}
            aria-label={`Book a viewing for ${vehicleLabel}`}
            data-vehicle-contact="booking"
            className="col-span-2 flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Calendar className="w-4 h-4" />
            Book a Viewing
          </a>
        </div>
    </div>
  );
}
