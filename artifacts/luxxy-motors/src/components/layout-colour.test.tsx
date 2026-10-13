import { describe, expect, it } from 'vitest';
import { readableForegroundForHsl } from '@/components/layout';
import { readableAccentForHsl } from '@/lib/brand-colour';

describe('dealer brand colour contrast', () => {
  it('uses dark ink over the configured bright brass accent', () => {
    expect(readableForegroundForHsl('38 92% 50%')).toBe('0 0% 8%');
  });

  it('uses warm paper over the configured dark ink primary', () => {
    expect(readableForegroundForHsl('188 50% 14%')).toBe('0 0% 100%');
  });

  it('accepts comma-separated HSL values from dealer configuration', () => {
    expect(readableForegroundForHsl('45, 100%, 70%')).toBe('0 0% 8%');
  });

  it('keeps a legible dealer accent unchanged', () => {
    expect(readableAccentForHsl('203 58% 31%')).toBe('203 58% 31%');
  });

  it.each(['38 92% 50%', '190 86% 44%', '300 100% 59%', '45, 100%, 95%'])('keeps the dealer hue while making %s readable on the light customer canvas', value => {
    const before = value.match(/[\d.]+/g)!.map(Number);
    const result = readableAccentForHsl(value);
    const after = result.match(/[\d.]+/g)!.map(Number);
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).toBeLessThan(before[2]);
    // A standard HSL-to-sRGB conversion checks the resulting rendered colour.
    const [h, s, l] = [after[0] / 360, after[1] / 100, after[2] / 100];
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const channel = (offset: number) => {
      const t = (h + offset + 1) % 1;
      const rgb = t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
      return rgb <= .04045 ? rgb / 12.92 : ((rgb + .055) / 1.055) ** 2.4;
    };
    const luminance = .2126 * channel(1 / 3) + .7152 * channel(0) + .0722 * channel(-1 / 3);
    const canvasChannels = [245, 246, 247].map(byte => ((byte / 255 + .055) / 1.055) ** 2.4);
    const canvas = canvasChannels[0] * .2126 + canvasChannels[1] * .7152 + canvasChannels[2] * .0722;
    expect((canvas + .05) / (luminance + .05)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back safely when an accent is absent or malformed', () => {
    expect(readableAccentForHsl('')).toBe(readableAccentForHsl('not a colour'));
    expect(readableForegroundForHsl(readableAccentForHsl(''))).toBe('0 0% 100%');
  });
});
