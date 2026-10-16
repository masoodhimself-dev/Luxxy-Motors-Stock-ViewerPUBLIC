import { hexColourContrast, hexColourToHsl, hslColourToHex, readableHexOnSurface } from './brand-colour';

type CustomerColours = {
  primaryHsl?: string;
  accentHsl?: string;
  pageColour?: string | null;
  panelColour?: string | null;
  headingColour?: string | null;
  linkColour?: string | null;
};

const validColour = (value: string | null | undefined, fallback: string) => /^#[\da-f]{6}$/i.test(value ?? '') ? value! : fallback;
const mix = (first: string, second: string, weight: number) => `#${[1, 3, 5].map(index => Math.round(
  parseInt(first.slice(index, index + 2), 16) * weight + parseInt(second.slice(index, index + 2), 16) * (1 - weight),
).toString(16).padStart(2, '0')).join('')}`;

/** Presentation only: never rewrite the dealer's saved settings. */
export function customerThemeVariables(colours: CustomerColours): Record<string, string> {
  const page = validColour(colours.pageColour, '#f5f6f7');
  const panel = validColour(colours.panelColour, '#ffffff');
  const heading = validColour(colours.headingColour, '#192a36');
  const link = validColour(colours.linkColour, '#215a7e');
  const primary = hslColourToHex(colours.primaryHsl ?? '195 22% 13%');
  const accent = hslColourToHex(colours.accentHsl ?? '203.226 58.491% 31.176%', '#215a7e');
  const variables: Record<string, string> = { '--dealer-page': page, '--dealer-panel': panel };
  const surfaces = { page, panel };
  for (const [name, surface] of Object.entries(surfaces)) {
    let subtle = mix(readableHexOnSurface(heading, surface), surface, .055);
    // Labels also sit in the lightly tinted inset panels. Check that nearby
    // surface as well; otherwise a just-readable dark theme loses contrast.
    const readable = (text: string) => readableHexOnSurface(readableHexOnSurface(text, surface), subtle);
    // Around middle grey, adding the inset tint can cross the point at which
    // white must become black text. Keep that inset on the original surface
    // when no shared text choice is readable on both backgrounds.
    if ([heading, '#586976', primary, accent, link, '#9b2727'].some(text => {
      const candidate = readable(text);
      return [surface, subtle].some(background => hexColourContrast(candidate, background) < 4.5);
    })) subtle = surface;
    const ink = readable(heading);
    const muted = readable('#586976');
    const readablePrimary = readable(primary);
    const readableAccent = readable(accent);
    const destructive = readable('#9b2727');
    const errorTint = mix(destructive, surface, .1);
    variables[`--dealer-${name}-ink`] = ink;
    variables[`--dealer-${name}-ink-hsl`] = hexColourToHsl(ink);
    variables[`--dealer-${name}-muted`] = muted;
    variables[`--dealer-${name}-muted-hsl`] = hexColourToHsl(muted);
    variables[`--dealer-${name}-link`] = readable(link);
    variables[`--dealer-${name}-accent`] = readableAccent;
    variables[`--dealer-${name}-accent-hsl`] = hexColourToHsl(readableAccent);
    variables[`--dealer-${name}-accent-foreground-hsl`] = hexColourToHsl(readableHexOnSurface('#ffffff', readableAccent));
    variables[`--dealer-${name}-primary-hsl`] = hexColourToHsl(readablePrimary);
    variables[`--dealer-${name}-primary-foreground-hsl`] = hexColourToHsl(readableHexOnSurface('#ffffff', readablePrimary));
    variables[`--dealer-${name}-subtle`] = subtle;
    variables[`--dealer-${name}-subtle-hsl`] = hexColourToHsl(subtle);
    variables[`--dealer-${name}-border`] = mix(ink, surface, .2);
    variables[`--dealer-${name}-border-hsl`] = hexColourToHsl(variables[`--dealer-${name}-border`]);
    variables[`--dealer-${name}-input-hsl`] = hexColourToHsl(readableHexOnSurface('#7f8b94', surface, 3));
    variables[`--dealer-${name}-destructive`] = destructive;
    variables[`--dealer-${name}-destructive-hsl`] = hexColourToHsl(destructive);
    variables[`--dealer-${name}-destructive-foreground-hsl`] = hexColourToHsl(readableHexOnSurface('#ffffff', destructive));
    variables[`--dealer-${name}-error-surface`] = hexColourContrast(destructive, errorTint) >= 4.5 ? errorTint : surface;
  }
  return {
    ...variables,
    '--dealer-heading': variables['--dealer-page-ink'],
    '--dealer-link': variables['--dealer-page-link'],
    '--dealer-foreground': variables['--dealer-page-ink'],
    '--dealer-muted': variables['--dealer-page-muted'],
    '--premium-ink': variables['--dealer-page-ink'],
    '--premium-muted': variables['--dealer-page-muted'],
    '--premium-border': variables['--dealer-page-border'],
    '--premium-canvas': page,
    '--premium-panel': panel,
    '--premium-accent': variables['--dealer-page-accent'],
    '--premium-accent-foreground': `hsl(${variables['--dealer-page-accent-foreground-hsl']})`,
    '--background': hexColourToHsl(page),
    '--foreground': hexColourToHsl(variables['--dealer-page-ink']),
    '--muted-foreground': hexColourToHsl(variables['--dealer-page-muted']),
    '--secondary': variables['--dealer-page-subtle-hsl'],
    '--secondary-foreground': hexColourToHsl(readableHexOnSurface(heading, variables['--dealer-page-subtle'])),
    '--muted': variables['--dealer-page-subtle-hsl'],
    '--border': hexColourToHsl(variables['--dealer-page-border']),
    '--input': variables['--dealer-panel-input-hsl'],
    '--card': hexColourToHsl(panel),
    '--card-foreground': hexColourToHsl(variables['--dealer-panel-ink']),
    '--popover': hexColourToHsl(panel),
    '--popover-foreground': hexColourToHsl(variables['--dealer-panel-ink']),
    '--primary': variables['--dealer-page-primary-hsl'],
    '--primary-foreground': variables['--dealer-page-primary-foreground-hsl'],
    '--accent': variables['--dealer-page-accent-hsl'],
    '--accent-foreground': variables['--dealer-page-accent-foreground-hsl'],
    '--ring': variables['--dealer-page-accent-hsl'],
    '--destructive': variables['--dealer-page-destructive-hsl'],
    '--destructive-foreground': variables['--dealer-page-destructive-foreground-hsl'],
    '--customer-error-surface': variables['--dealer-page-error-surface'],
    '--customer-footer-background': primary,
    '--customer-footer-background-hsl': hexColourToHsl(primary),
    '--customer-footer-foreground': readableHexOnSurface('#ffffff', primary),
    '--customer-footer-foreground-hsl': hexColourToHsl(readableHexOnSurface('#ffffff', primary)),
    '--customer-footer-muted': readableHexOnSurface(mix('#ffffff', primary, .75), primary),
    '--customer-footer-muted-hsl': hexColourToHsl(readableHexOnSurface(mix('#ffffff', primary, .75), primary)),
  };
}
