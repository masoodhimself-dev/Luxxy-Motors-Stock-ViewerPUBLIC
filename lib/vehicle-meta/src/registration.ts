export interface VehicleRegistrationSource {
  plate?: string | null;
  vrm?: string | null;
  registration?: string | null;
  registrationBand?: string | null;
  year?: number | null;
}

// Current, prefix, suffix and dateless UK registrations, including NI plates.
const UK_PLATE_PATTERNS = [
  /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/,
  /^[A-Z][0-9]{1,3}[A-Z]{3}$/,
  /^[A-Z]{3}[0-9]{1,3}[A-Z]$/,
  /^[A-Z]{1,3}[0-9]{1,4}$/,
  /^[0-9]{1,4}[A-Z]{1,3}$/,
];

export function isUKNumberPlate(value?: string | null): boolean {
  const raw = value?.trim() || '';
  if (!raw || /\breg\b|[()]/i.test(raw)) return false;
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  return UK_PLATE_PATTERNS.some((pattern) => pattern.test(compact));
}

/** Real number plate only. A year or registration band is never a plate. */
export function vehicleRegistration(vehicle?: VehicleRegistrationSource | null): string {
  const plate = [vehicle?.plate, vehicle?.vrm, vehicle?.registration]
    .find((value) => isUKNumberPlate(value));
  return plate?.trim().toUpperCase().replace(/\s+/g, ' ') || '';
}

/** Plate for identifying a car; otherwise its existing registration/year label. */
export function vehicleRegistrationLabel(vehicle?: VehicleRegistrationSource | null): string {
  const plate = vehicleRegistration(vehicle);
  if (plate) return plate;
  const fallback = [vehicle?.registration, vehicle?.registrationBand]
    .map((value) => value?.trim().replace(/\s+/g, ' ') || '')
    .find((value) => value && !/^(?:unknown|not supplied|not available|n\/?a|none|null|undefined|-)$/i.test(value));
  const year = typeof vehicle?.year === 'number' && vehicle.year > 1900 ? String(vehicle.year) : '';
  if (fallback && year && /^\d{2}(?:\s+reg)?$/i.test(fallback)) {
    return [year, `(${fallback.slice(0, 2)} reg)`].filter(Boolean).join(' ');
  }
  return fallback || year;
}
