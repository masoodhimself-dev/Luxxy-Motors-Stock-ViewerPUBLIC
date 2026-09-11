import { describe, expect, it } from 'vitest';
import { expectBrutalistGeometry, radiusClasses, shadowClasses } from '@/test/showroom-style';

// Guards the guard: if these stop holding, the primitive checks above them stop
// meaning anything.
describe('brutalist showroom rule', () => {
  it('reads a radius or shadow hidden behind a state or breakpoint prefix', () => {
    expect(radiusClasses('rounded-none hover:rounded-md')).toEqual(['rounded-none', 'rounded-md']);
    expect(shadowClasses('md:!shadow-lg')).toEqual(['shadow-lg']);
  });

  it('treats shadow-none as flat, not as a drop shadow', () => {
    expect(shadowClasses('shadow-none')).toEqual([]);
    expect(shadowClasses('shadow-sm')).toEqual(['shadow-sm']);
    expect(shadowClasses('shadow-[4px_4px_0px_hsl(var(--primary))]')).toEqual(['shadow-[4px_4px_0px_hsl(var(--primary))]']);
  });

  it('accepts a control that writes its own rounded-none and hard-offset shadows', () => {
    expect(() =>
      expectBrutalistGeometry('h-4 w-4 shrink-0 rounded-none shadow-[2px_2px_0px_hsl(var(--primary))]', 'checkbox'),
    ).not.toThrow();
    expect(() =>
      expectBrutalistGeometry('h-11 w-full rounded-none border-2 border-primary px-3 shadow-none', 'select'),
    ).not.toThrow();
  });

  it('fails a primitive that reintroduces a rounded radius or soft shadow', () => {
    expect(() => expectBrutalistGeometry('flex h-10 w-full rounded-md border', 'field')).toThrow();
    expect(() => expectBrutalistGeometry('rounded-none shadow-sm', 'field')).toThrow();
    expect(() => expectBrutalistGeometry('rounded-none hover:rounded-md', 'field')).toThrow();
    // A primitive with no radius at all inherits whatever a starter-kit theme sets,
    // so an explicit `rounded-none` is required rather than merely assumed.
    expect(() => expectBrutalistGeometry('flex h-10 w-full border', 'field')).toThrow();
  });
});
