/** Useful price bands for this showroom, while keeping a linked custom budget selectable. */
export function stockBudgetOptions(cars: ReadonlyArray<{ price?: number | null }>, selected = ''): number[] {
  const prices = cars.map(car => car.price).filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
  const maximum = prices.length ? Math.max(...prices) : 30_000;
  const minimum = prices.length ? Math.min(...prices) : 5_000;
  const step = maximum <= 15_000 ? 2_500 : maximum <= 30_000 ? 5_000 : maximum <= 100_000 ? 10_000 : maximum <= 250_000 ? 25_000 : maximum <= 500_000 ? 50_000 : Math.ceil(maximum / 10 / 100_000) * 100_000;
  const first = Math.max(step, Math.floor(minimum / step) * step);
  const last = Math.ceil(maximum / step) * step;
  const bands: number[] = [];
  for (let index = 0; index < 12; index += 1) {
    const price = first + index * step;
    if (!Number.isFinite(price) || price > last) break;
    bands.push(price);
  }
  if (selected.trim() && Number.isFinite(Number(selected)) && Number(selected) >= 0) bands.push(Number(selected));
  return [...new Set(bands)].sort((a, b) => a - b);
}
