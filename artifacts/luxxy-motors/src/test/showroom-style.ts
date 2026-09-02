import { expect } from 'vitest';

/**
 * The showroom identity is squared and flat: the shared primitives ship
 * `rounded-none` and no drop shadow, so no buyer-facing screen has to undo a
 * starter-kit radius. A surface that genuinely wants a soft edge opts into it
 * with its own `rounded-*` / `shadow-*` class at the call site, which
 * tailwind-merge applies on top of the default.
 *
 * These helpers read a rendered `class` attribute, so a regression is caught
 * wherever it hides — a cva variant, a `hover:` state or a breakpoint.
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

/** Every drop-shadow utility on the class list. `shadow-none` is flat, so it is not one. */
export function shadowClasses(className: string) {
  return utilities(className).filter(
    (utility) => /^-?shadow(-|$)/.test(utility) && utility !== 'shadow-none',
  );
}

/**
 * Fails when a primitive's default class list carries any radius other than an
 * explicit `rounded-none`, or any drop shadow at all. `label` names the
 * primitive so a failure says which one drifted.
 */
export function expectSquaredAndFlat(className: string, label: string) {
  expect(radiusClasses(className), `${label} radius`).toEqual(['rounded-none']);
  expect(shadowClasses(className), `${label} shadow`).toEqual([]);
}
