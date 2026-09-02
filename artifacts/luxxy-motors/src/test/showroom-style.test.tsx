import { describe, expect, it } from 'vitest';
import { expectSquaredAndFlat, radiusClasses, shadowClasses } from '@/test/showroom-style';

// Guards the guard: if these stop holding, the primitive checks above them stop
// meaning anything.
describe('squared, flat showroom rule', () => {
  it('reads a radius or shadow hidden behind a state or breakpoint prefix', () => {
    expect(radiusClasses('rounded-none hover:rounded-md')).toEqual(['rounded-none', 'rounded-md']);
    expect(shadowClasses('md:!shadow-lg')).toEqual(['shadow-lg']);
  });

  it('treats shadow-none as flat, not as a drop shadow', () => {
    expect(shadowClasses('shadow-none')).toEqual([]);
    expect(shadowClasses('shadow-sm')).toEqual(['shadow-sm']);
  });

  it('accepts a control that writes its own rounded-none, such as a native select or checkbox', () => {
    expect(() =>
      expectSquaredAndFlat('h-4 w-4 shrink-0 rounded-none accent-[hsl(var(--primary))]', 'checkbox'),
    ).not.toThrow();
    expect(() =>
      expectSquaredAndFlat('h-11 w-full rounded-none border border-border px-3', 'select'),
    ).not.toThrow();
  });

  it('fails a primitive that reintroduces a rounded or shadowed default', () => {
    expect(() => expectSquaredAndFlat('flex h-10 w-full rounded-md border', 'field')).toThrow();
    expect(() => expectSquaredAndFlat('rounded-none shadow-sm', 'field')).toThrow();
    expect(() => expectSquaredAndFlat('rounded-none hover:rounded-md', 'field')).toThrow();
    // A primitive with no radius at all inherits whatever a starter-kit theme sets,
    // so an explicit `rounded-none` is required rather than merely assumed.
    expect(() => expectSquaredAndFlat('flex h-10 w-full border', 'field')).toThrow();
  });
});
