// Staff history is separate from public browsing history. Store IDs only, for
// one signed-in staff member and dealer, and only for this browser tab.
export const STAFF_RECENT_CARS_LIMIT = 6;
export function staffRecentCarsKey(dealerId?: string, staffId?: string) {
  return dealerId && staffId ? `luxxy:staff-recent-cars:${JSON.stringify([dealerId, staffId])}` : null;
}
export function parseStaffRecentCars(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)))].slice(0, STAFF_RECENT_CARS_LIMIT)
      : [];
  } catch { return []; }
}
export function rememberStaffCar(ids: string[], id: string) {
  return parseStaffRecentCars(JSON.stringify([id, ...ids.filter(previous => previous !== id)]));
}
