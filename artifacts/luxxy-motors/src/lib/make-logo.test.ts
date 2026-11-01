import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getMakeLogoSrc } from './make-logo';

describe('supplied make logos', () => {
  it.each([
    ['Mercedes', 'mercedes-benz'], ['MERCEDES-BENZ', 'mercedes-benz'], ['Mercedes Benz', 'mercedes-benz'],
    ['Volkswagon', 'volkswagen'], ['VW', 'volkswagen'], [' Volkswagen ', 'volkswagen'],
    ['Citroën', 'citroen'], ['Škoda', 'skoda'], ['LandRover', 'land-rover'], ['Land Rover', 'land-rover'],
    ['AlfaRomeo', 'alfa-romeo'], ['Alfa Romeo', 'alfa-romeo'], ['BMW', 'bmw'], ['KGM Motors', 'kgm-motors'],
    ['Aston-Martin', 'aston-martin'], ['Lynk & Co', 'lynk-and-co'],
  ])('maps %s to the supplied %s SVG', (make, file) => {
    expect(getMakeLogoSrc(make)).toBe(`/brand/car-makes/${file}.svg`);
  });

  it.each([null, undefined, '', 'Unknown', 'Ford Focus', '../../ford.svg', '__proto__', 'constructor', 'https://example.com/ford.svg'])('omits an unrecognised make: %s', make => {
    expect(getMakeLogoSrc(make)).toBeNull();
  });

  it('only returns existing locally supplied assets, including makes outside the source menu', () => {
    const directory = resolve(import.meta.dirname, '../../public/brand/car-makes');
    const files = readdirSync(directory).filter(file => file.endsWith('.svg'));
    expect(files).toHaveLength(128);
    for (const file of files) {
      const src = getMakeLogoSrc(file.slice(0, -4));
      expect(src).toBe(`/brand/car-makes/${file}`);
      expect(existsSync(resolve(directory, file))).toBe(true);
      expect(readFileSync(resolve(directory, file), 'utf8')).toContain('<svg');
    }
  });
});
