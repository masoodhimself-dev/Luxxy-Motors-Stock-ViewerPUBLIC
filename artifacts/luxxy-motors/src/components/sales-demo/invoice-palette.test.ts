import { describe, expect, it } from 'vitest';
import { invoicePalette } from '@workspace/vehicle-meta';
function contrastOnWhite(hex: string) {
  const channels = [1,3,5].map(i => parseInt(hex.slice(i, i + 2),16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055)/1.055) ** 2.4);
  return 1.05 / (channels.reduce((sum, v, i) => sum + v * [.2126,.7152,.0722][i], 0) + .05);
}
describe('document brand colours', () => {
  it.each(['#ffffff', '#ffeb00', '#00ffff', '#215a7e', '#aa2255', '#000000'])('keeps white lettering readable for %s', accent => {
    const palette = invoicePalette(accent);
    expect(palette.accent).toBe(accent);
    expect(contrastOnWhite(palette.strong)).toBeGreaterThanOrEqual(4.5);
  });
  it('rejects invalid values and keeps dealer palettes independent', () => {
    expect(invoicePalette('url(bad)')).toEqual(invoicePalette());
    expect(invoicePalette('#225588')).not.toEqual(invoicePalette('#885522'));
  });
});
