import { hslColourToHex, readableHexOnSurface } from './brand-colour.ts';

type VehicleSheetColourOptions = { accentColour?: string; useWebsiteColour?: boolean };
const validOverride = (value?: string) => /^#[0-9a-f]{6}$/i.test(value ?? '');
/** Old records with a saved colour retain it; new records inherit website branding. */
export function vehicleSheetUsesWebsiteColour(options?: VehicleSheetColourOptions) {
  return options?.useWebsiteColour ?? !validOverride(options?.accentColour);
}
/** Preserve the custom override even while inheritance is on, so switching back restores it. */
export function vehicleSheetAccent(primaryHsl: string | undefined, printOverride?: string, useWebsiteColour?: boolean) {
  const useWebsite = vehicleSheetUsesWebsiteColour({ accentColour: printOverride, useWebsiteColour });
  return useWebsite
    ? readableHexOnSurface(hslColourToHex(primaryHsl ?? '', '#263c46'), '#ffffff')
    : validOverride(printOverride) ? printOverride! : '#263c46';
}
