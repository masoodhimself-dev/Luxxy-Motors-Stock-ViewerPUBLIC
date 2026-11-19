import type { ReactNode } from 'react';
import './grand-touring-vehicle.css';

type GrandTouringVehicleProps = {
  identity: ReactNode;
  gallery: ReactNode;
  price: ReactNode;
  registration: ReactNode;
  facts: ReactNode;
  mot: ReactNode;
  actions: ReactNode;
  highlights: ReactNode;
  reservation: ReactNode;
  photoRequest: ReactNode;
};

/** The existing CarDetail slots retain ownership of data, actions and feature gates. */
export function GrandTouringVehicle({ identity, gallery, price, registration, facts, mot, actions, highlights, reservation, photoRequest }: GrandTouringVehicleProps) {
  return <section className="gt-vehicle" data-template-composition="grand-touring" aria-label="Vehicle photographs and purchase details">
    <div className="gt-vehicle-layout">
      <div className="gt-vehicle-heading-row">
        <div className="gt-vehicle-heading">{identity}</div>
        <div className="gt-vehicle-price">{price}</div>
      </div>
      <div className="gt-vehicle-gallery">{gallery}</div>
      <div className="gt-vehicle-facts">{facts}</div>
      <div className="gt-vehicle-records">{registration}{mot}</div>
      <aside className="gt-vehicle-contact" aria-label="Contact the dealership about this car">
        {actions}
        {reservation}
      </aside>
    </div>
    {highlights && <details className="gt-vehicle-highlights"><summary>More about this car</summary>{highlights}</details>}
    {photoRequest}
  </section>;
}

export function GrandTouringVehicleContent({ navigation, children }: { navigation: ReactNode; children: ReactNode }) {
  return <div className="gt-vehicle-information">
    <div className="gt-vehicle-contents">{navigation}</div>
    <div className="gt-vehicle-sections">{children}</div>
  </div>;
}
