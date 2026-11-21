import { describe, expect, it } from 'vitest';
import { hexColourContrast, hexColourToHsl } from './brand-colour';
import { websiteTemplatePalettes, websiteTemplateThemeVariables } from './website-template-theme';

describe('customer template presentation tokens', () => {
  it('leaves legacy websites to their existing theme', () => {
    expect(websiteTemplateThemeVariables(null)).toEqual({});
  });
  it('uses the original AutoDeal accent and heading font only for the AutoDeal website', () => {
    const theme = websiteTemplateThemeVariables('autodeal');
    expect(theme['--ad-orange']).toBe('#ff7101');
    expect(theme['--ct-ink']).toBe('#24272c');
    expect(theme['--customer-footer-background']).toBe('#24272c');
    expect(theme['--font-display']).toContain('Outfit');
    expect(websiteTemplateThemeVariables('grand-touring')).not.toHaveProperty('--ad-orange');
  });
  it('uses the Regent Lane palette and Poppins for its shared pages and dialogs', () => {
    const theme = websiteTemplateThemeVariables('regent-lane');
    expect(theme['--ct-ink']).toBe('#100e34');
    expect(theme['--ct-accent']).toBe('#a2001d');
    expect(theme['--ct-paper']).toBe('#fffffe');
    expect(theme['--ct-subtle']).toBe('#f8f8f8');
    expect(theme['--ct-explorer']).toBe('#eaebf0');
    expect(theme['--app-font-sans']).toMatch(/^'Poppins', 'DM Sans'/);
    expect(theme['--font-display']).toBe(theme['--app-font-sans']);
  });
  for (const [id, palette] of Object.entries(websiteTemplatePalettes)) {
    it(`${id} keeps labels and actions readable on its real surfaces`, () => {
      for (const surface of [palette.canvas, palette.surface]) {
        expect(hexColourContrast(palette.ink, surface)).toBeGreaterThanOrEqual(4.5);
        expect(hexColourContrast(palette.muted, surface)).toBeGreaterThanOrEqual(4.5);
        expect(hexColourContrast(palette.action, surface)).toBeGreaterThanOrEqual(4.5);
      }
      expect(hexColourContrast('#ffffff', palette.action)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${id} carries the same action and body font through shared pages and dialogs`, () => {
      const variables = websiteTemplateThemeVariables(id as keyof typeof websiteTemplatePalettes);
      expect(variables['--primary']).toBe(hexColourToHsl(palette.action));
      expect(variables['--mh-accent']).toBe(palette.action);
      expect(variables['--ring']).toBe(variables['--primary']);
      expect(variables['--dealer-panel-primary-hsl']).toBe(variables['--primary']);
      expect(variables['--app-font-sans']).toContain(id === 'grand-touring' ? 'Manrope' : id === 'regent-lane' ? 'Poppins' : 'Inter');
      expect(variables['--font-display']).toBe(variables['--ct-font-heading']);
      expect(variables['--ct-font-heading'].includes('Manrope')).toBe(id === 'grand-touring');
    });
  }
});
