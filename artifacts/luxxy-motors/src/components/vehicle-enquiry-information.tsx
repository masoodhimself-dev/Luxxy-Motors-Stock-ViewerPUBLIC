import { useEffect, useId, useState } from 'react';
import { Link } from 'wouter';
import type { MotHistory } from '@workspace/vehicle-meta';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from '@/lib/utils';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import { formatRegistrationPlate } from '@/lib/registration-display';
import { usableVehicleMotHistory } from '@/lib/vehicle-answer-summary';
import { vehicleEnquiryFacts, vehicleEnquiryMot } from '@/lib/vehicle-enquiry-information';
import { BadgePoundSterling, ChevronDown, CircleCheck, Handshake, Shield, Truck } from './icons';
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
export function VehicleEnquiryInformation({ car, motHistory, requestMotHistory, dealer, includedItems, compact = false, registrationInSummary = false }: {
  car: Car;
  motHistory: MotHistory | null;
  requestMotHistory: () => void;
  dealer?: DealerConfig;
  includedItems: readonly string[];
  compact?: boolean;
  registrationInSummary?: boolean;
}) {
  const titleId = useId();
  const [failedPhoto, setFailedPhoto] = useState('');
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

  if (compact) {
    const photo = getThumbnailUrl(car);
    const headlineLabels = ['Year', 'Mileage', 'Transmission'];
    const headlineFacts = headlineLabels.flatMap(label => facts.filter(fact => fact.label === label));
    if (registrationInSummary && registration) headlineFacts.unshift({ label: 'Registration', value: formatRegistrationPlate(registration) });
    const detailFacts = facts.filter(fact => !headlineLabels.includes(fact.label));
    const warranty = includes.find(item => /warranty/i.test(item));
    const otherInclusions = includes.filter(item => item !== warranty);
    const registrationInDetails = !registrationInSummary && registration;
    const hasDetails = Boolean(detailFacts.length || registrationInDetails || mot);
    const hasBuyingOptions = Boolean(otherInclusions.length || uniqueReasons.length || dealer?.warranty?.enabled);
    return <aside className="gr-enquiry-car" data-testid="vehicle-enquiry-information" aria-labelledby={titleId}>
      <div className="gr-enquiry-car__top">
        {photo && photo !== failedPhoto && <img
          className="gr-enquiry-car__photo"
          src={photo}
          {...responsiveVehicleImage(photo, '(max-width: 760px) 80px, 96px')}
          width={96} height={72} alt="" decoding="async" referrerPolicy="no-referrer"
          onError={event => { if (!retryOriginalImage(event.currentTarget)) setFailedPhoto(photo); }}
        />}
        <div className="gr-enquiry-car__identity">
          <h3 id={titleId}>{vehicleDisplayTitle(car)}</h3>
          {(car.variant || car.trim) && <p>{car.variant || car.trim}</p>}
          <strong>{car.price ? formatPrice(car.price, car.currency) : 'Price on application'}</strong>
        </div>
      </div>
      {headlineFacts.length > 0 && <dl className="gr-enquiry-car__key-facts">
        {headlineFacts.map(fact => <div key={fact.label}><dt className="sr-only">{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>}
      {warranty && <p className="gr-enquiry-car__warranty"><Shield aria-hidden="true" size={16} />{warranty}</p>}
      {hasDetails && <details open className="gr-enquiry-car__details">
        <summary>Car details <ChevronDown aria-hidden="true" size={16} /></summary>
        <dl className="gr-enquiry-car__facts">
          {registrationInDetails && <div><dt>Registration</dt><dd>{registrationInDetails}</dd></div>}
          {mot && <div data-testid="enquiry-vehicle-mot"><dt>{mot.label}</dt><dd>{mot.value}</dd></div>}
          {detailFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
        </dl>
      </details>}
      {hasBuyingOptions && <details open className="gr-enquiry-car__details">
        <summary>Buying options <ChevronDown aria-hidden="true" size={16} /></summary>
        {otherInclusions.length > 0 && <ul className="gr-enquiry-car__benefits">
          {otherInclusions.map(item => <li key={item}><BenefitIcon text={item} /><span>{item}</span></li>)}
        </ul>}
        {uniqueReasons.length > 0 && <ul className="gr-enquiry-car__benefits">
          {uniqueReasons.map(reason => <li key={reason.title}>
            <BenefitIcon text={reason.title} />
            <div><strong>{reason.title}</strong>{reason.description?.trim() && <p>{reason.description}</p>}</div>
          </li>)}
        </ul>}
        {dealer?.warranty?.enabled && <Link className="vehicle-enquiry-warranty-link" href="/warranty">Warranty details</Link>}
      </details>}
    </aside>;
  }

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
