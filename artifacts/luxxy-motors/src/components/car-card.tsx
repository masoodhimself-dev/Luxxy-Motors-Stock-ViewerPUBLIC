import { useState } from 'react';
import { Link } from 'wouter';
import { Car } from '@/lib/stock-context';
import { formatPrice, formatMileage, getThumbnailUrl } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { MapPin, Fuel, Settings, Calendar, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function CarCard({ car }: { car: Car }) {
  const thumb = getThumbnailUrl(car);
  const [imgError, setImgError] = useState(false);

  const getWriteOffBadge = () => {
    if (!car.writeOffCategory) return null;
    const cat = car.writeOffCategory.toUpperCase();
    if (cat.includes('S') || cat === 'CAT S') {
      return <Badge variant="destructive" className="absolute top-3 right-3 shadow-md z-10"><AlertTriangle className="w-3 h-3 mr-1"/>Cat S</Badge>;
    }
    if (cat.includes('N') || cat === 'CAT N') {
      return <Badge variant="warning" className="absolute top-3 right-3 shadow-md z-10"><AlertTriangle className="w-3 h-3 mr-1"/>Cat N</Badge>;
    }
    return null;
  };

  return (
    <Link href={`/vehicle/${car.id}`} className="group block h-full">
      <div className="bg-card rounded-xl border overflow-hidden h-full flex flex-col transition-all duration-200 hover:shadow-lg hover:border-primary/30">
        
        {/* Image Container */}
        <div className="relative aspect-[4/3] bg-muted overflow-hidden">
          {getWriteOffBadge()}
          {thumb && !imgError ? (
            <img 
              src={thumb} 
              alt={car.title || `${car.make} ${car.model}`}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground bg-secondary text-sm">
              No Image
            </div>
          )}
          
          <div className="absolute bottom-3 left-3 flex gap-2">
            {(car.imageCount || (car.images?.length)) ? (
              <Badge variant="secondary" className="bg-black/60 text-white border-none backdrop-blur-md font-medium text-[10px]">
                {car.imageCount || car.images?.length} Photos
              </Badge>
            ) : null}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col flex-1">
          <div className="flex justify-between items-start gap-4 mb-2">
            <h3 className="font-bold text-lg leading-tight text-foreground line-clamp-2">
              {car.title || `${car.make} ${car.model}`}
            </h3>
          </div>
          
          {car.variant || car.trim ? (
            <p className="text-sm text-muted-foreground line-clamp-1 mb-4">
              {car.variant || car.trim}
            </p>
          ) : (
            <div className="mb-4"></div>
          )}

          <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm mb-6 text-muted-foreground flex-1 content-start">
            {car.year && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 shrink-0 text-primary/70" />
                <span className="truncate">{car.year} {car.registration ? `(${car.registration})` : ''}</span>
              </div>
            )}
            {(car.mileage || car.mileageText) && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 shrink-0 text-primary/70" />
                <span className="truncate">{car.mileage ? formatMileage(car.mileage) : car.mileageText}</span>
              </div>
            )}
            {car.fuel && (
              <div className="flex items-center gap-1.5">
                <Fuel className="w-4 h-4 shrink-0 text-primary/70" />
                <span className="truncate">{car.fuel}</span>
              </div>
            )}
            {car.transmission && (
              <div className="flex items-center gap-1.5">
                <Settings className="w-4 h-4 shrink-0 text-primary/70" />
                <span className="truncate">{car.transmission}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t pt-4 mt-auto">
            <div className="font-bold text-xl text-primary tracking-tight">
              {car.price ? formatPrice(car.price, car.currency) : 'POA'}
            </div>
            <Button variant="secondary" size="sm" className="font-semibold shrink-0">
              View Vehicle
            </Button>
          </div>
        </div>

      </div>
    </Link>
  );
}
