import { hexColourToHsl } from './brand-colour';
import { customerThemeVariables } from './customer-theme';
import type { CustomerWebsiteTemplate } from './website-template';

export const websiteTemplatePalettes = {
  showroom: { ink: '#1d2733', muted: '#596574', action: '#233b53', canvas: '#f2f4f7', line: '#d3dae2', surface: '#ffffff' },
  'grand-touring': { ink: '#172033', muted: '#596576', action: '#10183e', canvas: '#f5f6f7', line: '#d5dce6', surface: '#ffffff' },
  forecourt: { ink: '#28272a', muted: '#625e63', action: '#773d46', canvas: '#f3f3f4', line: '#d8d8dd', surface: '#ffffff' },
  autodeal: { ink: '#24272c', muted: '#62605e', action: '#ab4600', canvas: '#ffffff', line: '#e8e8e8', surface: '#ffffff' },
  panorama: { ink: '#25282c', muted: '#62666c', action: '#2f353d', canvas: '#f0f2f4', line: '#d7dbdf', surface: '#ffffff' },
  'regent-lane': { ink: '#100e34', muted: '#5d5b6d', action: '#a2001d', canvas: '#fffffe', line: '#d9dae1', surface: '#fffffe' },
} as const;

const uiFont = "'Inter', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** One opted-in palette for the complete customer journey, including body portals.
 * Saved dealership identity, financial documents and legacy websites are untouched. */
export function websiteTemplateThemeVariables(template: CustomerWebsiteTemplate | null): Record<string, string> {
  if (!template) return {};
  const autoDeal = template === 'autodeal';
  const regentLane = template === 'regent-lane';
  const templateUiFont = template === 'grand-touring' ? "'Manrope', ui-sans-serif, system-ui, sans-serif"
    : regentLane ? "'Poppins', 'DM Sans', ui-sans-serif, system-ui, sans-serif" : uiFont;
  const templateHeadingFont = template === 'grand-touring' ? "'Manrope', ui-sans-serif, sans-serif" : autoDeal ? "'Outfit', ui-sans-serif, system-ui, sans-serif" : templateUiFont;
  const p = websiteTemplatePalettes[template];
  const subtle = regentLane ? '#f8f8f8' : p.canvas;
  const tint = regentLane ? '#eaebf0' : p.canvas;
  const action = hexColourToHsl(p.action), ink = hexColourToHsl(p.ink), muted = hexColourToHsl(p.muted);
  const variables = customerThemeVariables({ primaryHsl: action, accentHsl: action,
    pageColour: p.canvas, panelColour: p.surface, headingColour: p.ink, linkColour: p.action });
  for (const name of ['page', 'panel']) {
    variables[`--dealer-${name}-muted`] = p.muted;
    variables[`--dealer-${name}-muted-hsl`] = muted;
    variables[`--dealer-${name}-border`] = p.line;
    variables[`--dealer-${name}-border-hsl`] = hexColourToHsl(p.line);
    variables[`--dealer-${name}-subtle`] = subtle;
    variables[`--dealer-${name}-subtle-hsl`] = hexColourToHsl(subtle);
  }
  const autoDealTokens: Record<string, string> = autoDeal ? {
    '--ad-orange': '#ff7101',
    '--customer-footer-background': p.ink,
    '--customer-footer-background-hsl': ink,
    '--customer-footer-foreground': '#ffffff',
    '--customer-footer-foreground-hsl': '0 0% 100%',
    '--customer-footer-muted': '#bfc0c1',
    '--customer-footer-muted-hsl': hexColourToHsl('#bfc0c1'),
  } : {};
  return { ...variables, ...autoDealTokens,
    '--ct-ink': p.ink, '--ct-muted': p.muted, '--ct-accent': p.action,
    '--ct-paper': p.canvas, '--ct-line': p.line, '--ct-surface': p.surface,
    ...(regentLane ? { '--ct-subtle': subtle, '--ct-explorer': tint } : {}),
    '--ct-font-ui': templateUiFont,
    '--ct-font-heading': templateHeadingFont,
    '--app-font-sans': templateUiFont, '--font-display': templateHeadingFont, '--font-body': templateUiFont,
    '--dealer-primary': action, '--dealer-primary-foreground': '0 0% 100%',
    '--dealer-accent': action, '--dealer-accent-foreground': '0 0% 100%',
    '--dealer-muted': p.muted, '--premium-muted': p.muted, '--premium-border': p.line,
    '--muted-foreground': muted, '--secondary': hexColourToHsl(subtle),
    '--muted': hexColourToHsl(subtle), '--border': hexColourToHsl(p.line),
    '--primary': action, '--primary-foreground': '0 0% 100%',
    '--accent': action, '--accent-foreground': '0 0% 100%', '--ring': action,
    '--premium-accent': p.action, '--premium-accent-foreground': '#ffffff',
    '--contact': action, '--contact-foreground': '0 0% 100%', '--dealer-whatsapp-icon': p.ink,
    '--customer-positive': p.ink, '--customer-positive-soft': p.canvas, '--customer-positive-border': p.line,
    '--mh-primary': p.ink, '--mh-text': p.ink, '--mh-accent': p.action, '--mh-accent-dark': p.ink,
    '--mh-bg': p.canvas, '--mh-hero-bg': subtle, '--mh-surface': p.surface,
    '--mh-border': p.line, '--mh-border-strong': p.muted, '--mh-photo-bg': p.canvas,
    '--mh-muted': p.muted, '--mh-tint': tint, '--mh-chip': subtle,
    '--mh-weight-heading': template === 'panorama' ? '500' : '600',
    '--foreground': ink,
  };
}
