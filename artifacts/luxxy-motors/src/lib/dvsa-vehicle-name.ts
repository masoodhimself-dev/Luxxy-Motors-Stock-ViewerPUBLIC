const acronyms = new Set(['BMW', 'MG', 'MINI', 'VW', 'DS', 'GMC', 'TVR', 'PHEV', 'MHEV', 'VTEC', 'DOHC', 'SOHC', 'TFSI', 'TDCI']);

/** Display only: normalise provider ALL-CAPS names, retaining supplied mixed
 * case and compact model codes. Never rewrite the underlying DVSA response. */
export function formatDvsaVehicleName(value: string | null | undefined, kind: 'make' | 'model'): string {
  const name = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!name || name !== name.toUpperCase()) return name;
  return name.split(' ').map(word => {
    if (acronyms.has(word) || (kind === 'model' && (/\d/.test(word) || /^[A-Z]{1,3}$/.test(word) || /^[A-Z0-9]{1,3}(?:[-/.][A-Z0-9]{1,3})+$/.test(word)))) return word;
    return word.split('-').map(part => acronyms.has(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join('-');
  }).join(' ');
}

export function dvsaVehicleName(vehicle: {make: string | null; model: string | null}): string {
  return [formatDvsaVehicleName(vehicle.make, 'make'), formatDvsaVehicleName(vehicle.model, 'model')].filter(Boolean).join(' ');
}
