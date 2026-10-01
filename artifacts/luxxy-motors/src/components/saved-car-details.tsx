import { Link } from 'wouter';
import type { Car } from '@/lib/stock-context';
import { vehicleContent } from '@/lib/vehicle-content';
import { getVehicleBookingHref } from '@/lib/cta-helpers';
import { vehicleDisplayTitle } from '@/lib/utils';

export function SavedCarDetails({car}: {car: Car}) {
 const {description,features}=vehicleContent(car);
 const facts=[['Engine',car.engineSize],['Body',car.bodyType],['Colour',car.colour],['Doors',car.doors],['Seats',car.seats],['Emissions',car.emissionClass],['Previous owners',car.owners]].filter(([,value])=>value!==null && value!==undefined && value!=='');
 return <div className="border-t border-border px-4 py-3 sm:px-6">
   {car.variant && <p className="mb-2 text-sm text-muted-foreground">{car.variant}</p>}
   <details>
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold" aria-label={`More details about ${vehicleDisplayTitle(car)}`}>More details</summary>
    {facts.length>0 && <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">{facts.map(([label,value])=><div key={label} className="flex justify-between gap-4 border-b border-border py-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl>}
    {description && <div className="mt-5 max-w-3xl"><h3 className="font-semibold">About this car</h3><p className="mt-2 whitespace-pre-line text-sm leading-7 text-muted-foreground">{description}</p></div>}
    {features.length>0 && <div className="mt-5"><h3 className="font-semibold">Equipment highlights</h3><ul className="mt-3 grid list-inside list-disc gap-2 text-sm sm:grid-cols-2">{features.slice(0,8).map(feature=><li key={feature}>{feature}</li>)}</ul></div>}
    <div className="mt-5 flex flex-wrap gap-3 pb-2"><Link className="vehicle-contact-action" href={`/vehicle/${car.id}`}>View full vehicle details</Link><Link className="vehicle-contact-action" href={getVehicleBookingHref(car)}>Book a test drive</Link></div>
   </details>
 </div>;
}
