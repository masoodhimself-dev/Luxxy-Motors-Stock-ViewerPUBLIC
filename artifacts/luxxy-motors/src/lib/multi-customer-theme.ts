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

/** Presentation only: no saved brand, permissions, invoice or tenant changes. */
export function multiCustomerThemeVariables(theme?: 'showroom-navy'): Record<string, string> {
  const showroomNavy = theme === 'showroom-navy';
  const p = showroomNavy ? showroomNavyPalette : multiCustomerPalette;
  const action = showroomNavy ? p.accent : p.primary;
  const accent = showroomNavy ? p.accent : p.accentDark;
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
  if (showroomNavy) {
    const input = hexColourToHsl(p.controlBorder);
    variables['--dealer-page-input-hsl'] = input;
    variables['--dealer-panel-input-hsl'] = input;
    variables['--input'] = input;
    variables['--mh-hero-bg'] = showroomNavyPalette.hero;
    variables['--dealer-whatsapp-icon'] = '#111b21';
    variables['--contact'] = hexColourToHsl(action);
    variables['--customer-positive'] = showroomNavyPalette.accent;
    variables['--customer-positive-soft'] = showroomNavyPalette.tint;
    variables['--customer-positive-border'] = showroomNavyPalette.border;
  }
  return {
    ...variables,
    '--app-font-sans': "'Multi Montserrat', Arial, sans-serif",
    '--font-display': "'Multi Montserrat', Arial, sans-serif",
    '--font-body': "'Multi Montserrat', Arial, sans-serif",
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
    '--mh-weight-heading': '700',
    '--mh-weight-label': '600',
    '--mh-weight-price': '800',
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
