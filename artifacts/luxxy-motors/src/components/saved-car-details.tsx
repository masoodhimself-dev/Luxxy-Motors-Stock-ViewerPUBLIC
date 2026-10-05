import { Link } from 'wouter';
import type { Car } from '@/lib/stock-context';
import { vehicleContent } from '@/lib/vehicle-content';
import { getVehicleBookingHref } from '@/lib/cta-helpers';
import { vehicleDisplayTitle, vehicleRegistrationLabel } from '@/lib/utils';
import { vehicleHistoryFacts, vehicleListingHighlights, vehicleRunningCosts } from '@/lib/vehicle-extra-facts';

export function SavedCarDetails({car}: {car: Car}) {
 const {description,features}=vehicleContent(car);
 const facts=[['Registration',vehicleRegistrationLabel(car)],['Engine',car.engineSize],['Body',car.bodyType],['Colour',car.colour],['Doors',car.doors],['Seats',car.seats],['Emissions',car.emissionClass],['Previous owners',car.owners]].filter(([,value])=>value!==null && value!==undefined && value!=='');
 const costs=vehicleRunningCosts(car), history=vehicleHistoryFacts(car), highlights=vehicleListingHighlights(car);
 return <div className="border-t border-border px-4 py-3 sm:px-6">
   {car.variant && <p className="mb-2 text-sm text-muted-foreground">{car.variant}</p>}
   <details>
    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold" aria-label={`More details about ${vehicleDisplayTitle(car)}`}>More details</summary>
    {facts.length>0 && <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">{facts.map(([label,value])=><div key={label} className="flex justify-between gap-4 border-b border-border py-3 text-sm"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{value}</dd></div>)}</dl>}
    {description && <div className="mt-5 max-w-3xl"><h3 className="font-semibold">About this car</h3><p className="mt-2 whitespace-pre-line text-sm leading-7 text-muted-foreground">{description}</p></div>}
    {features.length>0 && <div className="mt-5"><h3 className="font-semibold">Equipment highlights</h3><ul className="mt-3 grid list-inside list-disc gap-2 text-sm sm:grid-cols-2">{features.slice(0,8).map(feature=><li key={feature}>{feature}</li>)}</ul></div>}
    {costs.length>0 && <div className="mt-5"><h3 className="font-semibold">Running costs</h3><dl className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">{costs.map(item=><div key={item.label} className="border border-border p-3"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-1 font-medium">{item.value}</dd></div>)}</dl><p className="mt-2 text-xs text-muted-foreground">Figures supplied with the listing; actual fuel use and tax may vary.</p></div>}
    {history.length>0 && <div className="mt-5"><h3 className="font-semibold">Ownership & service records</h3><dl className="mt-2 grid gap-2 sm:grid-cols-3">{history.map(item=><div key={item.label} className="text-sm"><dt className="text-xs text-muted-foreground">{item.label}</dt><dd className="mt-1">{item.value}</dd></div>)}</dl></div>}
    {highlights.length>0 && <div className="mt-5"><h3 className="font-semibold">Listing highlights</h3><ul className="mt-2 space-y-2 text-sm">{highlights.map(item=><li key={item.label}><strong>{item.label}:</strong> {item.value}</li>)}</ul><p className="mt-2 text-xs text-muted-foreground">Comparisons supplied with the listing refer to similar vehicles.</p></div>}
    <div className="mt-5 flex flex-wrap gap-3 pb-2"><Link className="vehicle-contact-action" href={`/vehicle/${car.id}`}>View full vehicle details</Link>{(!car.inventoryStatus || car.inventoryStatus === 'available') && <Link className="vehicle-contact-action" href={getVehicleBookingHref(car)}>Book a test drive</Link>}</div>
   </details>
 </div>;
}
