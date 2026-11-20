import type { ReactNode } from 'react';
import './autodeal-vehicle.css';

type AutoDealVehicleProps = {
  identity: ReactNode;
  keyDetails: string[];
  facts: ReactNode;
  gallery: ReactNode;
  price: ReactNode;
  registration: ReactNode;
  mot: ReactNode;
  actions: ReactNode;
  reservation: ReactNode;
  navigation: ReactNode;
  children: ReactNode;
  photoRequest: ReactNode;
};

export function AutoDealVehicle({
  identity, keyDetails, facts, gallery, price, registration, mot, actions,
  reservation, navigation, children, photoRequest,
}: AutoDealVehicleProps) {
  return (
    <div className="ad-vehicle" data-template-composition="autodeal">
      <section className="ad-vehicle__price" aria-label="Vehicle and price">
        {identity}
        {keyDetails.length > 0 && <ul className="ad-vehicle__key-details" aria-label="Key vehicle details">
          {keyDetails.map((detail, index) => <li key={index}>{detail}</li>)}
        </ul>}
        <div className="ad-vehicle__price-and-registration">{price}{registration}</div>
        {mot}
      </section>
      <div className="ad-vehicle__gallery">{gallery}</div>
      <div className="ad-vehicle__contact">
        {actions}
        {reservation}
      </div>
      <div className="ad-vehicle__content vehicle-details-content min-w-0">
        {facts && <section className="ad-vehicle__summary" aria-label="Vehicle overview">
          <h2>Vehicle overview</h2>
          {facts}
        </section>}
        {navigation}
        {children}
        {photoRequest}
      </div>
    </div>
  );
}
