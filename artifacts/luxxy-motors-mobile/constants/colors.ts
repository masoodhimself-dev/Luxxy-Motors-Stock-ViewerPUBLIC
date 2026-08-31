/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Luxxy Motors: warm paper, midnight ink, brushed brass.
    text: '#263143',
    tint: '#DFAE2B',

    background: '#F8F5EE',
    foreground: '#263143',

    card: '#FFFCF6',
    cardForeground: '#263143',

    primary: '#283449',
    primaryForeground: '#F8F5EE',

    secondary: '#EAE4D8',
    secondaryForeground: '#303B4D',

    muted: '#E8E4DA',
    mutedForeground: '#667080',

    accent: '#DFAE2B',
    accentForeground: '#283449',

    destructive: '#B94A3E',
    destructiveForeground: '#ffffff',

    border: '#D8CFBE',
    input: '#D8CFBE',
  },

  dark: {
    text: '#F8F5EE',
    tint: '#E9B93F',
    background: '#1E2736',
    foreground: '#F8F5EE',
    card: '#283449',
    cardForeground: '#F8F5EE',
    primary: '#E9B93F',
    primaryForeground: '#1E2736',
    secondary: '#344055',
    secondaryForeground: '#F8F5EE',
    muted: '#344055',
    mutedForeground: '#C0C5CF',
    accent: '#E9B93F',
    accentForeground: '#1E2736',
    destructive: '#D16B5E',
    destructiveForeground: '#FFFFFF',
    border: '#465268',
    input: '#465268',
  },

  radius: 14,
};

export default colors;
