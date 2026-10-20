import type { Car } from './stock-context';

export function bodyTypeKey(value: string | null | undefined): string {
  return (value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
const names: Record<string, string> = {
  suv: 'SUV', mpv: 'MPV', hatchback: 'Hatchback', saloon: 'Saloon', estate: 'Estate',
  coupe: 'Coupé', convertible: 'Convertible', pickup: 'Pickup', van: 'Van',
};
/** Use supplied body types only; never infer one from a model name or photo. */
export function stockBodyTypes(cars: Car[]): Array<{ label: string; count: number }> {
  const types = new Map<string, { label: string; count: number }>();
  for (const car of cars) {
    const key = bodyTypeKey(car.bodyType);
    if (!key || ['unknown', 'n/a', 'not specified', 'other'].includes(key)) continue;
    const previous = types.get(key);
    if (previous) previous.count++;
    else types.set(key, { label: names[key] ?? car.bodyType!.trim(), count: 1 });
  }
  return [...types.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
