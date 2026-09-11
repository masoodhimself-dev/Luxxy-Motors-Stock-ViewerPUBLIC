import { expect } from 'vitest';

/**
 * The showroom identity is brutalist automotive: square geometry and deliberate
 * hard-offset shadows (`shadow-[4px_4px_0px_hsl(var(--primary))]`), not soft dropshadows.
 */

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

/**
 * Fails when a primitive's default class list carries any radius other than an
 * explicit `rounded-none`. It ensures the element follows the brutalist rule.
 */
export function expectBrutalistGeometry(className: string, label: string) {
  expect(radiusClasses(className), `${label} radius`).toEqual(['rounded-none']);

  const shadows = shadowClasses(className);
  // Verify all shadows applied are hard-offset variants (starting with shadow-[)
  shadows.forEach(shadow => {
    expect(shadow, `${label} shadow should be a hard offset`).toMatch(/^shadow-\[/);
  });
}
