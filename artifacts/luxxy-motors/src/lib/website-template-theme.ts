import { hexColourToHsl } from './brand-colour';
import { customerThemeVariables } from './customer-theme';
import type { CustomerWebsiteTemplate } from './website-template';

export const websiteTemplatePalettes = {
  showroom: { ink: '#1d2733', muted: '#596574', action: '#233b53', canvas: '#f2f4f7', line: '#d3dae2', surface: '#ffffff' },
  'grand-touring': { ink: '#172033', muted: '#596576', action: '#10183e', canvas: '#f5f6f7', line: '#d5dce6', surface: '#ffffff' },
  forecourt: { ink: '#28272a', muted: '#625e63', action: '#773d46', canvas: '#f3f3f4', line: '#d8d8dd', surface: '#ffffff' },
  panorama: { ink: '#25282c', muted: '#62666c', action: '#2f353d', canvas: '#f0f2f4', line: '#d7dbdf', surface: '#ffffff' },
} as const;

const uiFont = "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** One opted-in palette for the complete customer journey, including body portals.
 * Saved dealership identity, financial documents and legacy websites are untouched. */
export function websiteTemplateThemeVariables(template: CustomerWebsiteTemplate | null): Record<string, string> {
  if (!template) return {};
  const templateUiFont = template === 'grand-touring' ? "'Manrope', ui-sans-serif, system-ui, sans-serif" : uiFont;
  const templateHeadingFont = template === 'grand-touring' ? "'Manrope', ui-sans-serif, sans-serif" : uiFont;
  const p = websiteTemplatePalettes[template];
  const action = hexColourToHsl(p.action), ink = hexColourToHsl(p.ink), muted = hexColourToHsl(p.muted);
  const variables = customerThemeVariables({ primaryHsl: action, accentHsl: action,
    pageColour: p.canvas, panelColour: p.surface, headingColour: p.ink, linkColour: p.action });
  for (const name of ['page', 'panel']) {
    variables[`--dealer-${name}-muted`] = p.muted;
    variables[`--dealer-${name}-muted-hsl`] = muted;
    variables[`--dealer-${name}-border`] = p.line;
    variables[`--dealer-${name}-border-hsl`] = hexColourToHsl(p.line);
    variables[`--dealer-${name}-subtle`] = p.canvas;
    variables[`--dealer-${name}-subtle-hsl`] = hexColourToHsl(p.canvas);
  }
  return { ...variables,
    '--ct-ink': p.ink, '--ct-muted': p.muted, '--ct-accent': p.action,
    '--ct-paper': p.canvas, '--ct-line': p.line, '--ct-surface': p.surface,
    '--ct-font-ui': templateUiFont,
    '--ct-font-heading': templateHeadingFont,
    '--app-font-sans': templateUiFont, '--font-display': template === 'grand-touring' ? templateHeadingFont : uiFont, '--font-body': templateUiFont,
    '--dealer-primary': action, '--dealer-primary-foreground': '0 0% 100%',
    '--dealer-accent': action, '--dealer-accent-foreground': '0 0% 100%',
    '--dealer-muted': p.muted, '--premium-muted': p.muted, '--premium-border': p.line,
    '--muted-foreground': muted, '--secondary': hexColourToHsl(p.canvas),
    '--muted': hexColourToHsl(p.canvas), '--border': hexColourToHsl(p.line),
    '--primary': action, '--primary-foreground': '0 0% 100%',
    '--accent': action, '--accent-foreground': '0 0% 100%', '--ring': action,
    '--premium-accent': p.action, '--premium-accent-foreground': '#ffffff',
    '--contact': action, '--contact-foreground': '0 0% 100%', '--dealer-whatsapp-icon': p.ink,
    '--customer-positive': p.ink, '--customer-positive-soft': p.canvas, '--customer-positive-border': p.line,
    '--mh-primary': p.ink, '--mh-text': p.ink, '--mh-accent': p.action, '--mh-accent-dark': p.ink,
    '--mh-bg': p.canvas, '--mh-hero-bg': p.canvas, '--mh-surface': p.surface,
    '--mh-border': p.line, '--mh-border-strong': p.muted, '--mh-photo-bg': p.canvas,
    '--mh-muted': p.muted, '--mh-tint': p.canvas, '--mh-chip': p.canvas,
    '--mh-weight-heading': template === 'panorama' ? '500' : '600',
    '--foreground': ink,
  };
}
