import type { Car } from "./stock-context";

export function getSimilarCars(currentCar: Car, cars: Car[]) {
  const priceRange = currentCar.price ? Math.max(2500, currentCar.price * 0.25) : null;

  return cars
    .filter((candidate) => candidate.id !== currentCar.id &&
      !['sold', 'archived', 'reserved'].includes(String(candidate.inventoryStatus || '').toLowerCase()) &&
      (!candidate.sourceStatus || candidate.sourceStatus === 'live'))
    .map((candidate) => {
      let score = 0;
      const priceDistance =
        currentCar.price != null && candidate.price != null
          ? Math.abs(currentCar.price - candidate.price)
          : Number.MAX_SAFE_INTEGER;

      if (currentCar.make && candidate.make === currentCar.make) score += 5;
      if (currentCar.model && candidate.model === currentCar.model) score += 5;
      if (currentCar.bodyType && candidate.bodyType === currentCar.bodyType) score += 3;
      if (currentCar.fuel && candidate.fuel === currentCar.fuel) score += 2;
      if (currentCar.transmission && candidate.transmission === currentCar.transmission) score += 2;
      if (
        currentCar.year != null &&
        candidate.year != null &&
        Math.abs(currentCar.year - candidate.year) <= 2
      )
        score += 1;
      if (priceRange != null && candidate.price != null && priceDistance <= priceRange) score += 2;

      const sameModel = Boolean(currentCar.make && currentCar.model && candidate.make === currentCar.make && candidate.model === currentCar.model);
      const comparableBudget = priceRange != null && candidate.price != null && priceDistance <= priceRange;
      const sameBody = Boolean(currentCar.bodyType && candidate.bodyType === currentCar.bodyType);
      return { candidate, score, priceDistance, relevant: sameModel || (sameBody && comparableBudget) };
    })
    .filter(({ relevant }) => relevant)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.priceDistance - right.priceDistance;
    })
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}
