import { describe, expect, it } from 'vitest';
import { expectRefinedGeometry, radiusClasses, shadowClasses } from '@/test/showroom-style';

// Guards the guard: if these stop holding, the primitive checks above them stop
// meaning anything.
describe('refined showroom rule', () => {
  it('reads a radius or shadow hidden behind a state or breakpoint prefix', () => {
    expect(radiusClasses('rounded-none hover:rounded-md')).toEqual(['rounded-none', 'rounded-md']);
    expect(shadowClasses('md:!shadow-lg')).toEqual(['shadow-lg']);
  });

  it('treats shadow-none as flat, not as a drop shadow', () => {
    expect(shadowClasses('shadow-none')).toEqual([]);
    expect(shadowClasses('shadow-sm')).toEqual(['shadow-sm']);
    expect(shadowClasses('shadow-[4px_4px_0px_hsl(var(--primary))]')).toEqual(['shadow-[4px_4px_0px_hsl(var(--primary))]']);
  });

  it('accepts the shared restrained geometry', () => {
    expect(() => expectRefinedGeometry('h-11 rounded-md border shadow-none', 'control')).not.toThrow();
  });
  it('rejects pill shapes, hard shadows and unspecified geometry', () => {
    expect(() => expectRefinedGeometry('rounded-full shadow-none', 'field')).toThrow();
    expect(() => expectRefinedGeometry('rounded-md shadow-[4px_4px_0px_black]', 'field')).toThrow();
    expect(() => expectRefinedGeometry('rounded-md hover:rounded-full', 'field')).toThrow();
    expect(() => expectRefinedGeometry('h-11 border', 'field')).toThrow();
  });
});
