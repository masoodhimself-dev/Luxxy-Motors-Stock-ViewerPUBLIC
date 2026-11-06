/** Public identifiers are supplied by the server, never taken from marketplace advert URLs. */
export type PublicVehicleLink = {
  id: string;
  make?: string | null;
  model?: string | null;
  title?: string | null;
  sourceExtras?: Record<string, unknown> | null;
};

export const PUBLIC_VEHICLE_CODE_PATTERN = /^[a-z0-9]{8}$/;

export function vehiclePublicCode(vehicle: Pick<PublicVehicleLink, 'sourceExtras'>): string | null {
  const code = vehicle.sourceExtras?.publicVehicleCode;
  return typeof code === 'string' && PUBLIC_VEHICLE_CODE_PATTERN.test(code) ? code : null;
}

export function vehicleDetailPath(vehicle: PublicVehicleLink): string {
  const code = vehiclePublicCode(vehicle);
  if (!code) return `/vehicle/${encodeURIComponent(vehicle.id)}`;
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.title || 'car';
  const slug = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55).replace(/-+$/g, '') || 'car';
  return `/cars/${slug}-${code}`;
}

export function vehicleSharePath(vehicle: PublicVehicleLink): string {
  const code = vehiclePublicCode(vehicle);
  return code ? `/s/${code}` : `/share/vehicle/${encodeURIComponent(vehicle.id)}`;
}

/** A code is only a lookup key. Public visibility and dealership scope stay server-side. */
export function vehicleCodeFromPath(pathname: string): string | null {
  const path = pathname.split(/[?#]/, 1)[0];
  return /^\/s\/([a-z0-9]{8})\/?$/.exec(path)?.[1]
    ?? /^\/cars\/[a-z0-9]+(?:-[a-z0-9]+)*-([a-z0-9]{8})\/?$/.exec(path)?.[1]
    ?? null;
}

export function isVehiclePagePath(pathname: string): boolean {
  return /^\/vehicle\/[^/]+\/?$/.test(pathname) || vehicleCodeFromPath(pathname) !== null;
}

export function vehicleMatchesPath(vehicle: PublicVehicleLink, pathname: string): boolean {
  const code = vehicleCodeFromPath(pathname);
  if (code) return code === vehiclePublicCode(vehicle);
  const id = /^\/vehicle\/([^/?#]+)\/?$/.exec(pathname)?.[1];
  try { return Boolean(id && decodeURIComponent(id) === vehicle.id); } catch { return false; }
}
