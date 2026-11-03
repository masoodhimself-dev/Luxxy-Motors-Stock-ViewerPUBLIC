import { Link } from 'wouter';
import type { Car } from '@/lib/stock-context';
import { formatMileage, formatPrice, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { formatRegistrationPlate } from '@/lib/registration-display';
import { stockRegistrationYear, stockVariant } from '@/lib/stock-presentation';
import { stockCardSellingPoints } from '@/lib/stock-card-presentation';
import { vehicleInsuranceDisclosure } from '@/lib/vehicle-history';
import { vehicleContent } from '@/lib/vehicle-content';
import { MakeLogo } from './make-logo';
import { ArrowRight, CircleCheck } from './icons';
import { VehicleFactIcon } from './vehicle-fact-icon';
import './recommended-car-summary.css';

/** A compact comparison summary for the vehicle page's recommendations. */
export function RecommendedCarSummary({ car, onOpen, stretchedLink, includedItems = [] }: {
  car: Car;
  onOpen: () => void;
  stretchedLink: boolean;
  includedItems?: string[];
}) {
  const title = vehicleDisplayTitle(car), href = `/vehicle/${car.id}`;
  const registration = vehicleRegistration(car), variant = stockVariant(car);
  const engineCC = Number(car.engineCC);
  const highlights = [...new Set([...includedItems.slice(0, 1), ...stockCardSellingPoints(car).filter(point => !/\bwarranty\b/i.test(point))])].slice(0, 2);
  const disclosure = vehicleInsuranceDisclosure(car, vehicleContent(car).description);
  const vatLabel = car.priceType && /^(?:\+\s*VAT|VAT (?:included|qualifying)|inc(?:lusive of)?\.? VAT|ex(?:cluding)?\.? VAT)$/i.test(car.priceType.trim()) ? car.priceType : null;
  const facts = [
    { label: 'Year', value: stockRegistrationYear(car) },
    { label: 'Mileage', value: car.mileage != null ? formatMileage(car.mileage) : car.mileageText },
    { label: 'Gearbox', value: car.transmission },
    { label: 'Fuel', value: car.fuel },
    { label: 'Engine', value: Number.isInteger(engineCC) && engineCC > 0 ? `${engineCC.toLocaleString('en-GB')}cc` : car.engineSize },
    { label: 'Body', value: car.bodyType },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value));

  return <div className="recommended-car-summary">
    <div className="recommended-car-identity">
      <h3>
        <MakeLogo make={car.make} size={24} />
        <Link href={href} onClick={onOpen} className={stretchedLink ? 'recommended-car-stretched-link' : undefined}>{title}</Link>
      </h3>
      <div className="recommended-car-price-group">
        <p className={`recommended-car-price${car.price ? '' : ' recommended-car-price-on-request'}`}>
          {car.price ? formatPrice(car.price, car.currency) : 'Price on application'}
        </p>
        {vatLabel && <span className="recommended-car-vat">{vatLabel}</span>}
      </div>
    </div>
    {variant && <p className="recommended-car-variant" title={variant}>{variant}</p>}
    {disclosure && <p className="recommended-car-disclosure">{disclosure.cardLabel}<span className="sr-only">: {disclosure.explanation}</span></p>}
    {facts.length > 0 && <dl className="recommended-car-facts">
      {facts.map(fact => <div key={fact.label}>
        <dt className="sr-only">{fact.label}</dt>
        <dd><VehicleFactIcon label={fact.label} value={fact.value} />{fact.value}</dd>
      </div>)}
    </dl>}
    {highlights.length > 0 && <ul className="recommended-car-highlights" aria-label="Vehicle highlights">
      {highlights.map(point => <li key={point}><CircleCheck aria-hidden="true" />{point}</li>)}
    </ul>}
    <div className="recommended-car-footer">
      {registration && <span className="recommended-car-registration" aria-label={`Registration: ${formatRegistrationPlate(registration)}`}>{formatRegistrationPlate(registration)}</span>}
      <Link href={href} onClick={onOpen} className="recommended-car-view" aria-label={`View ${title}`}>View car<ArrowRight aria-hidden="true" /></Link>
    </div>
  </div>;
}
