import { describe, expect, it } from 'vitest';
import { hexToHsl, hslToHex, isValidHsl } from './colour-field';

describe('dealer colour formats', () => {
  it('round trips neutral, saturated and brand colours without changing the settings format', () => {
    for (const colour of ['#000000', '#ffffff', '#ff0000', '#123456', '#996633', '#eeeeee']) {
      const hsl = hexToHsl(colour);
      expect(isValidHsl(hsl)).toBe(true);
      expect(hslToHex(hsl)).toBe(colour);
    }
  });
  it('accepts existing comma and space syntax and rejects invalid ranges', () => {
    expect(hslToHex('210, 50%, 40%')).toBe(hslToHex('210 50% 40%'));
    for (const value of ['hello', '30 110% 50%', '-30 10% 10%', '361 10% 50%', '30 10% 120%']) expect(isValidHsl(value)).toBe(false);
  });
});
