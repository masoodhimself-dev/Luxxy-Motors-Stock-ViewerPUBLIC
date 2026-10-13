import { describe, expect, it } from 'vitest';
import { customerThemeVariables } from './customer-theme';
import { hexColourContrast, hslColourToHex } from './brand-colour';

describe('customer dealer palette', () => {
  it('keeps legible bespoke colours and supplied surfaces exactly', () => {
    const supplied = { pageColour: '#edf6f4', panelColour: '#fff6e8', headingColour: '#5b2635', linkColour: '#254e77' };
    const palette = customerThemeVariables(supplied);
    expect(palette['--dealer-page']).toBe(supplied.pageColour);
    expect(palette['--dealer-panel']).toBe(supplied.panelColour);
    expect(palette['--dealer-page-ink']).toBe(supplied.headingColour);
    expect(palette['--dealer-panel-ink']).toBe(supplied.headingColour);
    expect(palette['--dealer-page-link']).toBe(supplied.linkColour);
    expect(palette['--dealer-panel-link']).toBe(supplied.linkColour);
    expect(supplied).toEqual({ pageColour: '#edf6f4', panelColour: '#fff6e8', headingColour: '#5b2635', linkColour: '#254e77' });
  });

  it.each([
    { pageColour: '#ffffff', panelColour: '#fff6e8', headingColour: '#ffffdf', linkColour: '#ffffdf', primaryHsl: '45 80% 85%', accentHsl: '42 80% 75%' },
    { pageColour: '#f5f6f7', panelColour: '#192a36', headingColour: '#192a36', linkColour: '#215a7e' },
    { pageColour: '#192a36', panelColour: '#ffffff', headingColour: '#5b2635', linkColour: '#215a7e' },
    { pageColour: '#17131d', panelColour: '#21342b', headingColour: '#252525', linkColour: '#201326', primaryHsl: '300 20% 20%', accentHsl: '190 80% 22%' },
    ...['#6f6f6f', '#707070', '#717171', '#727272', '#737373', '#747474', '#757575', '#767676', '#777777', '#787878', '#797979', '#7a7a7a', '#7b7b7b'].map(colour => ({ pageColour: colour, panelColour: colour })),
  ])('keeps all text and action pairs readable on each actual surface: %o', supplied => {
    const palette = customerThemeVariables(supplied);
    for (const name of ['page', 'panel']) {
      const surface = palette[`--dealer-${name}`];
      for (const kind of ['ink', 'muted', 'link', 'accent', 'destructive']) {
        expect(hexColourContrast(palette[`--dealer-${name}-${kind}`], surface), `${name} ${kind}`).toBeGreaterThanOrEqual(4.5);
        expect(hexColourContrast(palette[`--dealer-${name}-${kind}`], palette[`--dealer-${name}-subtle`]), `${name} subtle ${kind}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(hexColourContrast(hslColourToHex(palette[`--dealer-${name}-input-hsl`]), surface)).toBeGreaterThanOrEqual(3);
      expect(hexColourContrast(palette[`--dealer-${name}-destructive`], palette[`--dealer-${name}-error-surface`])).toBeGreaterThanOrEqual(4.5);
      for (const action of ['primary', 'accent', 'destructive']) {
        const actionBackground = hslColourToHex(palette[`--dealer-${name}-${action}-hsl`]);
        const foreground = hslColourToHex(palette[`--dealer-${name}-${action}-foreground-hsl`]);
        expect(hexColourContrast(actionBackground, foreground), `${name} ${action} action`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(hexColourContrast(palette['--customer-footer-foreground'], palette['--customer-footer-background'])).toBeGreaterThanOrEqual(4.5);
    expect(hexColourContrast(palette['--customer-footer-muted'], palette['--customer-footer-background'])).toBeGreaterThanOrEqual(4.5);
  });

  it('uses independent foregrounds when page and panel are opposite tones', () => {
    const palette = customerThemeVariables({ pageColour: '#ffffff', panelColour: '#141414' });
    expect(palette['--dealer-page-ink']).not.toBe(palette['--dealer-panel-ink']);
    expect(palette['--card']).toBe(palette['--popover']);
    expect(hslColourToHex(palette['--card'])).toBe('#141414');
    expect(hslColourToHex(palette['--card-foreground'])).toBe(palette['--dealer-panel-ink']);
  });

  it('rejects invalid CSS colour values without leaking them into styles', () => {
    const palette = customerThemeVariables({ pageColour: 'red; display:none', panelColour: 'var(--unknown)', headingColour: '#fff', linkColour: 'url(https://example.test)', primaryHsl: 'none' });
    expect(palette['--dealer-page']).toBe('#f5f6f7');
    expect(palette['--dealer-panel']).toBe('#ffffff');
    expect(Object.values(palette).some(value => value.includes('url(') || value.includes('display:'))).toBe(false);
  });
});
