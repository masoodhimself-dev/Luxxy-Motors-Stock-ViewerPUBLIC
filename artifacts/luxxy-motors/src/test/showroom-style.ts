import { expect } from 'vitest';

// Small, consistent corners and flat surfaces keep attention on the vehicles.

/** Drops responsive/state prefixes and `!` markers so `md:!rounded-lg` reads as `rounded-lg`. */
export function utilities(className: string) {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.slice(token.lastIndexOf(':') + 1).replace(/^!/, ''));
}

/** Every radius utility on the class list, including an explicit `rounded-none`. */
export function radiusClasses(className: string) {
  return utilities(className).filter((utility) => /^-?rounded(-|$)/.test(utility));
}

/** Every drop-shadow utility on the class list. */
export function shadowClasses(className: string) {
  return utilities(className).filter(
    (utility) => /^-?shadow(-|\[|$)/.test(utility) && utility !== 'shadow-none',
  );
}

/** The shared control/surface defaults use a 4px radius and no ornamental shadow. */
export function expectRefinedGeometry(className: string, label: string) {
  expect(radiusClasses(className), `${label} radius`).toEqual(['rounded-md']);
  expect(shadowClasses(className), `${label} shadow`).toEqual([]);
}
