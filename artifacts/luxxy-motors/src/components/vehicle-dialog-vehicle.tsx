import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Car } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { readableForegroundForHsl } from '@/lib/brand-colour';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import './vehicle-dialog.css';

/** Dialogs are portalled, so carry the dealership's colours with them. */
export function useVehicleDialogTheme(): CSSProperties {
  const { settings } = useDealerSettings();
  return useMemo(() => {
    const configuredAccent = settings.identity.brandColors?.accentHsl;
    const defaultAccent = !configuredAccent || ['30.000 40.659% 35.686%', '190 86% 44%', '42 82% 49%'].includes(configuredAccent);
    const colour = (value: string | null | undefined, fallback: string) => value && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
    return {
      '--dialog-ink': colour(settings.presentation?.headingColour, '#192a36'),
      '--dialog-accent': defaultAccent ? '#215a7e' : `hsl(${configuredAccent})`,
      '--dialog-accent-foreground': defaultAccent ? '#fff' : `hsl(${readableForegroundForHsl(configuredAccent)})`,
      '--dialog-panel': colour(settings.presentation?.panelColour, '#fff'),
      '--dialog-subtle': colour(settings.presentation?.pageColour, '#f5f7f9'),
    } as CSSProperties;
  }, [settings.identity.brandColors?.accentHsl, settings.presentation?.headingColour, settings.presentation?.panelColour, settings.presentation?.pageColour]);
}

/** Only supplied vehicle facts are shown; missing or failed photography disappears. */
export function VehicleDialogVehicle({ car }: { car: Car }) {
  const photo = getThumbnailUrl(car);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo]);
  const facts = [customerRegistrationDetails(car), car.fuel, car.transmission].filter(Boolean);
  return <div className="vehicle-dialog-vehicle" data-testid="dialog-vehicle-card">
    {photo && !failed && <img src={photo} {...responsiveVehicleImage(photo, '112px')} alt={vehicleDisplayTitle(car)} width={112} height={84} decoding="async" referrerPolicy="no-referrer" onError={event => { if (!retryOriginalImage(event.currentTarget)) setFailed(true); }} />}
    <div className="vehicle-dialog-vehicle-info">
      <p className="vehicle-dialog-vehicle-title">{vehicleDisplayTitle(car)}</p>
      {facts.length > 0 && <p className="vehicle-dialog-muted">{facts.join(' · ')}</p>}
      {car.price != null && <p className="vehicle-dialog-vehicle-price">{formatPrice(car.price, car.currency)}</p>}
    </div>
  </div>;
}
