import { useRef } from 'react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { vehicleFeatureDetails } from '@/lib/vehicle-help';
import { VehicleFeatureArtwork } from './vehicle-feature-artwork';
import './vehicle-feature-panel.css';

/** Click-only explanations keep a large illustration from obscuring the list on hover. */
export function VehicleFeaturePanel({ feature }: { feature: string }) {
  const title = useRef<HTMLHeadingElement>(null);
  const details = vehicleFeatureDetails(feature);
  if (!details) return <span>{feature}</span>;

  return <Dialog>
    <DialogTrigger asChild>
      <button type="button" className="customer-term-help vehicle-feature-trigger">{feature}</button>
    </DialogTrigger>
    <DialogContent
      className="vehicle-feature-panel"
      overlayClassName="vehicle-feature-overlay"
      onOpenAutoFocus={event => {
        event.preventDefault();
        title.current?.focus({ preventScroll: true });
      }}
    >
      <div className="vehicle-feature-panel-content">
        <p className="vehicle-feature-eyebrow">Feature details</p>
        <VehicleFeatureArtwork kind={details.icon} />
        <DialogTitle ref={title} tabIndex={-1} className="vehicle-feature-title">{details.title}</DialogTitle>
        {details.title.toLowerCase() !== feature.trim().toLowerCase() && <p className="vehicle-feature-source">{feature}</p>}
        <DialogDescription className="vehicle-feature-description">{details.description}</DialogDescription>
      </div>
      <DialogClose className="vehicle-feature-dismiss">Got it</DialogClose>
    </DialogContent>
  </Dialog>;
}
