import { customerThemeVariables } from './customer-theme';
import { hexColourToHsl } from './brand-colour';

/** The shared Dealer OS design foundation for all public websites and staff portals. */
export const multiCustomerPalette = {
  primary: '#192a36',
  accent: '#a47a2b',
  accentDark: '#7c591a',
  tint: '#eef9fc',
  background: '#f9fafb',
  surface: '#ffffff',
  border: '#e1e5e8',
  muted: '#59656e',
  controlBorder: '#cdd3d8',
  photoBackground: '#f0f2f3',
  chip: '#eaf4f7',
} as const;

const showroomNavyPalette = {
  primary: '#182235',
  accent: '#182957',
  accentDark: '#263b70',
  tint: '#edf0f5',
  background: '#f6f7f9',
  surface: '#ffffff',
  border: '#d9dee6',
  muted: '#525d70',
  controlBorder: '#7a8597',
  photoBackground: '#edf0f3',
  chip: '#edf0f5',
  hero: '#e9edf4',
} as const;

export const graphitePalette = {
  primary: '#25282d', accent: '#25282d', accentDark: '#3b4047',
  tint: '#f3f4f5', background: '#ffffff', surface: '#ffffff',
  border: '#ced2d7', muted: '#565c64', controlBorder: '#858c96',
  photoBackground: '#f3f4f5', chip: '#f3f4f5', hero: '#f3f4f5',
} as const;

export const modernShowroomPalette = {
  primary: '#14233b', accent: '#173f8a', accentDark: '#12346f',
  tint: '#eef3f8', background: '#ffffff', surface: '#ffffff',
  border: '#ced9e7', muted: '#57667b', controlBorder: '#8291a5',
  photoBackground: '#eef3f8', chip: '#eef3f8', hero: '#ffffff',
} as const;

/** Presentation only: no saved brand, permissions, invoice or tenant changes. */
export function multiCustomerThemeVariables(theme?: 'showroom-navy' | 'graphite' | 'modern-showroom'): Record<string, string> {
  const modern = theme === 'modern-showroom';
  const graphite = theme === 'graphite';
  const refinedFonts = graphite || modern;
  const showroomNavy = theme === 'showroom-navy';
  const refined = showroomNavy || refinedFonts;
  const p = modern ? modernShowroomPalette : graphite ? graphitePalette : showroomNavy ? showroomNavyPalette : multiCustomerPalette;
  const action = refined ? p.accent : p.primary;
  const accent = refined ? p.accent : p.accentDark;
  const variables = customerThemeVariables({
    primaryHsl: hexColourToHsl(action),
    accentHsl: hexColourToHsl(accent),
    pageColour: p.background,
    panelColour: p.surface,
    headingColour: p.primary,
    linkColour: action,
  });
  for (const name of ['page', 'panel']) {
    variables[`--dealer-${name}-muted`] = p.muted;
    variables[`--dealer-${name}-muted-hsl`] = hexColourToHsl(p.muted);
    variables[`--dealer-${name}-border`] = p.border;
    variables[`--dealer-${name}-border-hsl`] = hexColourToHsl(p.border);
    variables[`--dealer-${name}-subtle`] = p.tint;
    variables[`--dealer-${name}-subtle-hsl`] = hexColourToHsl(p.tint);
  }
  if (refined) {
    const input = hexColourToHsl(p.controlBorder);
    variables['--dealer-page-input-hsl'] = input;
    variables['--dealer-panel-input-hsl'] = input;
    variables['--input'] = input;
    variables['--mh-hero-bg'] = modern ? modernShowroomPalette.hero : graphite ? graphitePalette.hero : showroomNavyPalette.hero;
    variables['--dealer-whatsapp-icon'] = '#111b21';
    variables['--contact'] = hexColourToHsl(action);
    variables['--customer-positive'] = p.accent;
    variables['--customer-positive-soft'] = p.tint;
    variables['--customer-positive-border'] = p.border;
  }
  const uiFont = modern ? "'DM Sans', Arial, sans-serif" : graphite ? "'Manrope', Arial, sans-serif" : "'Multi Montserrat', Arial, sans-serif";
  const headingFont = modern ? "'Outfit', Arial, sans-serif" : uiFont;
  return {
    ...variables,
    ...(refinedFonts ? { '--ct-font-ui': uiFont, '--ct-font-heading': headingFont } : {}),
    ...(modern ? {
      '--customer-footer-background': p.tint, '--customer-footer-background-hsl': hexColourToHsl(p.tint),
      '--customer-footer-foreground': p.primary, '--customer-footer-foreground-hsl': hexColourToHsl(p.primary),
      '--customer-footer-muted': p.muted, '--customer-footer-muted-hsl': hexColourToHsl(p.muted),
    } : {}),
    '--app-font-sans': uiFont,
    '--font-display': headingFont,
    '--font-body': uiFont,
    '--dealer-primary': hexColourToHsl(action),
    '--dealer-primary-foreground': '0 0% 100%',
    '--dealer-accent': hexColourToHsl(accent),
    '--dealer-accent-foreground': '0 0% 100%',
    '--dealer-muted': p.muted,
    '--premium-muted': p.muted,
    '--premium-border': p.border,
    '--muted-foreground': hexColourToHsl(p.muted),
    '--muted': hexColourToHsl(p.tint),
    '--secondary': hexColourToHsl(p.tint),
    '--border': hexColourToHsl(p.border),
    '--mh-primary': p.primary,
    '--mh-accent': p.accent,
    '--mh-accent-dark': p.accentDark,
    '--mh-tint': p.tint,
    '--mh-bg': p.background,
    '--mh-surface': p.surface,
    '--mh-border': p.border,
    '--mh-border-strong': p.controlBorder,
    '--mh-photo-bg': p.photoBackground,
    '--mh-dot': '#c8cfd4',
    '--mh-text': p.primary,
    '--mh-muted': p.muted,
    '--mh-chip': p.chip,
    '--mh-radius': '8px',
    '--mh-radius-panel': '8px',
    '--mh-radius-control': '4px',
    '--mh-weight-heading': modern ? '500' : graphite ? '600' : '700',
    '--mh-weight-label': '600',
    '--mh-weight-price': modern ? '500' : graphite ? '600' : '800',
    '--mh-overlay': 'rgb(25 42 54 / .3)',
    '--mh-shadow-sm': '0 1px 2px rgb(0 0 0 / 5%)',
    '--mh-shadow-md': '0 4px 6px -1px rgb(0 0 0 / 10%), 0 2px 4px -2px rgb(0 0 0 / 10%)',
    '--mh-shadow-lg': '0 10px 15px -3px rgb(0 0 0 / 10%), 0 4px 6px -4px rgb(0 0 0 / 10%)',
    '--dialog-ink': p.primary,
    '--dialog-accent': action,
    '--dialog-accent-foreground': p.surface,
    '--dialog-muted': p.muted,
    '--dialog-border': p.border,
    '--dialog-panel': p.surface,
    '--dialog-subtle': p.tint,
  };
}

/** Every portal shares the public design foundation without changing saved branding. */
export function multiPortalThemeVariables(): Record<string, string> {
  const p = multiCustomerPalette;
  return {
    ...multiCustomerThemeVariables(),
    '--portal-ink': p.primary,
    '--portal-accent': p.primary,
    '--portal-muted': p.muted,
    '--portal-canvas': p.background,
    '--portal-panel': p.surface,
    '--portal-border': p.border,
    '--portal-info': p.primary,
    '--portal-info-soft': p.tint,
    '--portal-info-border': p.border,
  };
}

/** Public presentation must never be selected by an editable dealership name. */
export function isCustomerWebsiteRoute(path: string): boolean {
  return !/^\/(?:portal|platform|sign-in|sign-up|join)(?:\/|$)/.test(path);
}
