import type { Car } from '@/lib/stock-context';
import { vehicleSellingPoints } from '@/lib/vehicle-selling-points';
import { VehicleFactIcon } from './vehicle-fact-icon';
import { VehicleTerm } from './customer-help';
export function VehicleSellingPoints({ car, compact = false }: { car: Car; compact?: boolean }) {
 const points = vehicleSellingPoints(car);
 if (!points.length) return null;
 return <div><ul aria-label="Vehicle highlights" className={`vehicle-selling-points flex flex-wrap gap-2 ${compact ? 'mb-3 mt-2' : 'mt-4 mb-2'}`}>{points.map(point => <li key={point.label} className={`inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-secondary/60 px-3 py-2 ${compact ? 'text-xs' : 'text-sm'} font-medium leading-5`}><VehicleTerm label={point.label} value={point.text}><VehicleFactIcon label={point.label} className="h-4 w-4 shrink-0 text-accent" /><span>{point.text}</span></VehicleTerm></li>)}</ul>{!compact && points.some(point => point.note) && <p className="text-xs leading-5 text-muted-foreground">Highlights use supplied listing figures. Please confirm annual tax with the team.</p>}</div>;
}
