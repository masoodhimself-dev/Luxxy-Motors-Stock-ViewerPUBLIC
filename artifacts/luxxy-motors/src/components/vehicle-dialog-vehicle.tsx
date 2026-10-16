import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Car } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { invoicePalette } from '@workspace/vehicle-meta';
import { hslToHex, isValidHsl } from '@/components/brand/colour-field';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import './vehicle-dialog.css';

const luminance = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (first: string, second: string) => (Math.max(luminance(first), luminance(second)) + .05) / (Math.min(luminance(first), luminance(second)) + .05);

/** Dialogs are portalled: carry the dealer hue and readable light surfaces with them. */
export function useVehicleDialogTheme(): CSSProperties {
  const { settings } = useDealerSettings();
  return useMemo(() => {
    const configuredAccent = settings.identity.brandColors?.accentHsl;
    const defaultAccent = !configuredAccent || ['30.000 40.659% 35.686%', '190 86% 44%', '42 82% 49%'].includes(configuredAccent);
    const accent = !defaultAccent && isValidHsl(configuredAccent!) ? hslToHex(configuredAccent!) : '#215a7e';
    const palette = invoicePalette(accent);
    const colour = (value: string | null | undefined, fallback: string) => value && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
    // A pale/strong brand variant keeps small links, labels and white button text
    // legible. Retain supplied surfaces and headings when their contrast is safe.
    const lightSurface = (value: string) => [palette.ink, palette.muted, palette.strong].every(text => contrast(text, value) >= 4.5) ? value : palette.soft;
    const panel = lightSurface(colour(settings.presentation?.panelColour, '#ffffff'));
    const subtle = lightSurface(colour(settings.presentation?.pageColour, '#f5f7f9'));
    const surfaces = [panel, subtle];
    const heading = colour(settings.presentation?.headingColour, palette.ink);
    const readableAccent = ['#ffffff', ...surfaces].every(surface => contrast(accent, surface) >= 4.5) ? accent : palette.strong;
    return {
      '--dialog-ink': surfaces.every(surface => contrast(heading, surface) >= 4.5) ? heading : palette.ink,
      '--dialog-accent': readableAccent,
      '--dialog-accent-foreground': '#ffffff',
      '--dialog-muted': palette.muted,
      '--dialog-border': palette.rule,
      '--dialog-panel': panel,
      '--dialog-subtle': subtle,
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
