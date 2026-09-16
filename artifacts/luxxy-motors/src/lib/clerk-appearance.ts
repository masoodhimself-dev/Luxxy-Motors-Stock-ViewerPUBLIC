import { shadcn } from '@clerk/themes';

// Appearance only. Clerk routing, session handling and access rules are unchanged.
export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
  },
  variables: {
    colorPrimary: 'hsl(170 15% 14%)', colorForeground: 'hsl(170 15% 14%)',
    colorMutedForeground: 'hsl(165 5% 39%)', colorDanger: 'hsl(0 60% 38%)',
    colorBackground: '#ffffff', colorInput: '#ffffff', colorInputForeground: 'hsl(170 15% 14%)',
    colorNeutral: 'hsl(40 10% 83%)', fontFamily: "'DM Sans', Arial, sans-serif", borderRadius: '4px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'surface w-[440px] max-w-full overflow-hidden shadow-none',
    card: '!shadow-none !border-0 !bg-transparent px-6 pt-8',
    footer: '!shadow-none !border-0 !bg-transparent',
    headerTitle: 'font-display text-2xl font-semibold text-primary',
    headerSubtitle: 'text-sm text-muted-foreground',
    formFieldLabel: 'text-sm font-medium text-primary',
    formFieldInput: 'luxxy-control',
    formButtonPrimary: 'min-h-11 bg-primary text-primary-foreground text-sm font-semibold shadow-none hover:bg-primary/90',
    socialButtonsBlockButton: 'min-h-11 rounded-md border border-border shadow-none',
    footerActionLink: 'text-sm font-semibold text-primary underline-offset-4 hover:underline',
  },
};
