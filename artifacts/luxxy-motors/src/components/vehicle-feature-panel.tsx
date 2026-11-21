import { useId, useRef, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { X } from '@/components/icons';
import { vehicleFeatureDetails, vehicleFeatureLabel } from '@/lib/vehicle-help';
import { VehicleFeatureArtwork } from './vehicle-feature-artwork';
import './vehicle-feature-panel.css';

/** Open a short, named explanation beside the equipment item. */
export function VehicleFeaturePanel({ feature, leadingIcon }: { feature: string; leadingIcon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const titleId = useId(), descriptionId = useId();
  const details = vehicleFeatureDetails(feature);
  if (!details) return <span>{feature}</span>;
  const label = vehicleFeatureLabel(feature);

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" className="customer-term-help vehicle-feature-trigger" title={label !== feature ? feature : undefined}>{leadingIcon}<span>{label}</span></button>
    </PopoverTrigger>
    <PopoverContent
      className="vehicle-feature-panel"
      align="start"
      side="top"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onOpenAutoFocus={event => {
        event.preventDefault();
        title.current?.focus({ preventScroll: true });
      }}
    >
      <div className="vehicle-feature-heading">
        <VehicleFeatureArtwork kind={details.icon} />
        <h3 id={titleId} ref={title} tabIndex={-1} className="vehicle-feature-title">{details.title}</h3>
        <button type="button" className="vehicle-feature-close" aria-label="Close" onClick={() => setOpen(false)}><X size={16} aria-hidden="true" /></button>
      </div>
      <p id={descriptionId} className="vehicle-feature-description">{details.description}</p>
      {details.title.toLowerCase() !== feature.trim().toLowerCase() && <p className="vehicle-feature-source">{feature}</p>}
    </PopoverContent>
  </Popover>;
}
