import { useEffect } from 'react';
import { Link } from 'wouter';
import type { MotHistory } from '@workspace/vehicle-meta';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { formatPrice, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { usableVehicleMotHistory } from '@/lib/vehicle-answer-summary';
import { vehicleEnquiryFacts, vehicleEnquiryMot } from '@/lib/vehicle-enquiry-information';
import { CircleCheck, Shield, Truck, Handshake, BadgePoundSterling } from './icons';
import { MakeLogo } from './make-logo';
import { UKNumberPlate } from './uk-number-plate';
import { VehicleFactIcon } from './vehicle-fact-icon';
import './vehicle-enquiry-information.css';

function BenefitIcon({ text }: { text: string }) {
  const Icon = /warranty|cover|protect/i.test(text) ? Shield
    : /deliver|collect|drive away/i.test(text) ? Truck
    : /price|value|payment/i.test(text) ? BadgePoundSterling
    : /service|care|pressure|hassle|friendly|exchange|trade/i.test(text) ? Handshake
    : CircleCheck;
  return <Icon aria-hidden="true" className="vehicle-enquiry-benefit-icon" />;
}

/** Context for the open message form, using this car and this dealer's saved promises. */
export function VehicleEnquiryInformation({ car, motHistory, requestMotHistory, dealer, includedItems }: {
  car: Car;
  motHistory: MotHistory | null;
  requestMotHistory: () => void;
  dealer?: DealerConfig;
  includedItems: readonly string[];
}) {
  const registration = vehicleRegistration(car);
  const mot = vehicleEnquiryMot(car, motHistory);
  const facts = vehicleEnquiryFacts(car);
  const includes = dealer ? includedItems : [];
  const configuredReasons = (dealer?.whyBuy ?? []).filter(reason => reason.title?.trim());
  const trustReasons = (dealer?.trustItems ?? []).filter(text => text.trim()).map(title => ({ title, description: '' }));
  // Older dealers may not have a separate buying-reasons list. Their enabled
  // services are still useful, but availability must never become free cover,
  // free delivery, or a promise to accept every part exchange.
  const serviceReasons = [
    dealer?.warranty?.enabled && !includes.some(item => /warranty/i.test(item)) && dealer.warranty.description.trim()
      ? { title: 'Warranty options', description: dealer.warranty.description } : null,
    dealer?.delivery?.enabled && dealer.delivery.description.trim()
      ? { title: 'Delivery options', description: dealer.delivery.description } : null,
    dealer?.partExchange?.enabled && dealer.partExchange.description.trim()
      ? { title: 'Part exchange welcome', description: dealer.partExchange.description } : null,
  ].filter((reason): reason is { title: string; description: string } => Boolean(reason));
  const reasons = configuredReasons.length ? configuredReasons : trustReasons.length ? trustReasons : serviceReasons;
  const uniqueReasons = reasons.filter((reason, index) => reasons.findIndex(item => item.title.trim().toLowerCase() === reason.title.trim().toLowerCase()) === index);

  useEffect(() => {
    // Expansion is a customer action. Reuse the page's one-shot lookup and its
    // cache instead of starting an independent request for the sidebar.
    if (registration && !usableVehicleMotHistory(car, motHistory)) requestMotHistory();
  }, [car, motHistory, registration, requestMotHistory]);

  return <aside className="vehicle-enquiry-information" data-testid="vehicle-enquiry-information" aria-label="Vehicle information and buying benefits">
    <section className="vehicle-enquiry-car" aria-labelledby="enquiry-car-heading">
      <h3 id="enquiry-car-heading">This car</h3>
      <div className="vehicle-enquiry-car-title"><MakeLogo make={car.make} size={28} /><h4>{vehicleDisplayTitle(car)}</h4></div>
      {(car.variant || car.trim) && <p className="vehicle-enquiry-variant">{car.variant || car.trim}</p>}
      <div className="vehicle-enquiry-car-price">
        <strong>{car.price ? formatPrice(car.price, car.currency) : 'Price on application'}</strong>
        {registration && <UKNumberPlate value={registration} size="sm" variant="front" testId="enquiry-vehicle-registration" />}
      </div>
      {facts.length > 0 && <dl className="vehicle-enquiry-facts">{facts.map(fact => <div key={fact.label}>
        <dt><VehicleFactIcon label={fact.label} value={fact.value} />{fact.label}</dt><dd>{fact.value}</dd>
      </div>)}</dl>}
      <div className="vehicle-enquiry-mot" data-testid="enquiry-vehicle-mot">
        <VehicleFactIcon label="MOT" />
        <div>{mot ? <><span>{mot.label}</span><strong>{mot.value}</strong></> : <><span>MOT</span><p>Ask us to confirm the current MOT.</p></>}</div>
      </div>
    </section>
    {includes.length > 0 && <section className="vehicle-enquiry-inclusions" aria-labelledby="enquiry-included-heading">
      <h3 id="enquiry-included-heading">What’s included</h3>
      <ul>{includes.map(item => <li key={item}><BenefitIcon text={item} /><span>{item}</span></li>)}</ul>
    </section>}
    {dealer?.warranty?.enabled && <Link className="vehicle-enquiry-warranty-link" href="/warranty"><Shield aria-hidden="true" />Warranty details</Link>}
    {uniqueReasons.length > 0 && <section className="vehicle-enquiry-reasons" aria-labelledby="enquiry-reasons-heading">
      <h3 id="enquiry-reasons-heading">{dealer?.identity.name?.trim() ? `Why choose ${dealer.identity.name}` : 'Why buy from us'}</h3>
      <ul>{uniqueReasons.slice(0, 3).map(reason => <li key={reason.title}>
        <BenefitIcon text={reason.title} /><div><strong>{reason.title}</strong>{reason.description?.trim() && <p>{reason.description}</p>}</div>
      </li>)}</ul>
      {uniqueReasons.length > 3 && <details className="vehicle-enquiry-more-reasons"><summary>More about buying from us</summary><ul>{uniqueReasons.slice(3).map(reason => <li key={reason.title}>
        <BenefitIcon text={reason.title} /><div><strong>{reason.title}</strong>{reason.description?.trim() && <p>{reason.description}</p>}</div>
      </li>)}</ul></details>}
    </section>}
  </aside>;
}
