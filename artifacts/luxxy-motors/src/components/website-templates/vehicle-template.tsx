import type { ReactNode } from 'react';
import type { Car } from '@/lib/stock-context';
import type { CustomerWebsiteTemplate } from '@/lib/website-template';
import { Gallery } from '@/components/gallery';
import { GrandTouringVehicle } from './grand-touring-vehicle';
import { getSafeImageUrl } from '@/lib/utils';
import { orderVehiclePhotos } from '@/lib/vehicle-photography';

type Props = { template: CustomerWebsiteTemplate; car: Car; identity: ReactNode; gallery: ReactNode; price: ReactNode; registration: ReactNode; facts: ReactNode; mot: ReactNode; actions: ReactNode; highlights: ReactNode; reservation: ReactNode; photoRequest: ReactNode; onEnquiry?: () => void };

/** Every slot comes from CarDetail's existing production components and gates. */
export function CustomerTemplateVehicle({ template, car, identity, gallery, price, registration, facts, mot, actions, highlights, reservation, photoRequest, onEnquiry }: Props) {
  const panel = <><div className="ct-vehicle-price-panel">{price}{registration}{mot}{actions}</div>{reservation}</>;
  const more = highlights && <details className="ct-vehicle-highlights"><summary>More about this car</summary>{highlights}</details>;
  if (template === 'showroom') return <div className="ct-vehicle ct-vehicle-showroom" data-template-composition="showroom"><div className="ct-vehicle-identity">{identity}</div><div className="ct-vehicle-retail-grid"><div className="ct-vehicle-photo-column">{gallery}</div><aside>{panel}{more}</aside><div className="ct-vehicle-strip">{facts}</div></div>{photoRequest}</div>;
  if (template === 'grand-touring') return <GrandTouringVehicle identity={identity} gallery={gallery} price={price} registration={registration} facts={facts} mot={mot} actions={actions} highlights={highlights} reservation={reservation} photoRequest={photoRequest}/>;
  if (template === 'forecourt') return <div className="ct-vehicle ct-vehicle-forecourt" data-template-composition="forecourt"><div className="ct-vehicle-sales-grid"><aside><div className="ct-vehicle-identity">{identity}</div>{panel}</aside><div className="ct-vehicle-photo-column">{gallery}<div className="ct-vehicle-table"><h2>At a glance</h2>{facts}{more}</div></div></div>{photoRequest}</div>;
  const companion = orderVehiclePhotos(car.images || [], car.heroImage)[1];
  return <div className="ct-vehicle ct-vehicle-panorama" data-template-composition="panorama"><div className={`ct-vehicle-panoramic-gallery${companion ? ' has-companion' : ''}`}>{gallery}{companion && <div className="ct-vehicle-companion"><Gallery key={`${car.id}-${getSafeImageUrl(companion)}`} car={car} images={car.images || []} heroImage={car.heroImage} initialImageUrl={getSafeImageUrl(companion)} vehicleLabel={[car.make, car.model].filter(Boolean).join(' ') || car.title || 'Vehicle'} customerView hideInlineThumbnails customerActions={onEnquiry ? { enquiryHref: '#vehicle-enquiry', onEnquiry } : undefined}/></div>}</div><div className="ct-vehicle-purchase-band"><div className="ct-vehicle-identity">{identity}{registration}</div><div>{price}{mot}</div><div>{actions}{reservation}</div></div><div className="ct-vehicle-strip">{facts}</div>{more}{photoRequest}</div>;
}
