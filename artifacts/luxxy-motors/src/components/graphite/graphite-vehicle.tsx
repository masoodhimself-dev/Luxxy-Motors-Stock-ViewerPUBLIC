import type { ReactNode } from 'react';
import type { Car } from '@/lib/stock-context';
import type { VehicleEnquiryFact } from '@/lib/vehicle-enquiry-information';
import { vehicleHistoryFacts } from '@/lib/vehicle-extra-facts';
import { VehicleTerm } from '@/components/customer-help';
import './graphite-vehicle.css';

type GraphiteVehicleProps = {
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
  sparse?: boolean;
};

/** Live CarDetail slots own the facts, gallery, contact actions and eligibility. */
export function GraphiteVehicle({ identity, price, gallery, facts, registration, mot, actions, reservation, highlights, photoRequest, sparse = false }: GraphiteVehicleProps) {
  return <section className="gr-vehicle" data-vehicle-composition="graphite" aria-label="Vehicle photographs and purchase details">
    <div className={`gr-vehicle-layout vehicle-detail-grid${sparse ? ' gr-vehicle-layout--sparse' : ''}`}>
      <div className="gr-vehicle-identity">{identity}{price}</div>
      <div className="gr-vehicle-gallery">{gallery}</div>
      <div className="gr-vehicle-facts">{facts}</div>
      <div className="gr-vehicle-records">{registration}{mot}</div>
      <aside className="gr-vehicle-contact" aria-label="Contact the dealership about this car">{actions}</aside>
    </div>
    {reservation}
    <div className="gr-vehicle-extras">
      {highlights && <details className="gr-vehicle-highlights"><summary>More about this car</summary>{highlights}</details>}
      {photoRequest}
    </div>
  </section>;
}

export function GraphiteVehicleContent({ navigation, children }: { navigation: ReactNode; children: ReactNode }) {
  return <div className="gr-vehicle-information">
    <div className="gr-vehicle-contents">{navigation}</div>
    <div className="gr-vehicle-sections">{children}</div>
  </div>;
}

/** The same supplied record facts and MOT action, arranged for the graphite page. */
export function GraphiteVehicleHistory({ car, mot, motAction }: { car: Car; mot: VehicleEnquiryFact | null; motAction: ReactNode }) {
  const facts = vehicleHistoryFacts(car);
  return <section aria-labelledby="vehicle-records-heading" className="gr-vehicle-history-summary">
    <h2 id="vehicle-records-heading" className="section-heading">MOT and vehicle records</h2>
    <div className="gr-vehicle-mot-summary">
      {mot && <dl><dt>{mot.label === 'MOT expires' ? 'MOT expiry' : mot.label}</dt><dd>{mot.value}</dd></dl>}
      {motAction}
    </div>
    <p>See the recorded MOT tests and mileage history. Ask the team for the available service documents.</p>
    {facts.length > 0 && <dl className="gr-vehicle-history-facts">{facts.map(fact => <div key={fact.label}><dt><VehicleTerm label={fact.label} value={fact.value}>{fact.label}</VehicleTerm></dt><dd>{fact.value}</dd></div>)}</dl>}
  </section>;
}
