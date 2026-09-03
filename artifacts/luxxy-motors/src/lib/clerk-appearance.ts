import { shadcn } from '@clerk/themes';

/**
 * Clerk styled in the showroom's language: warm paper, ink teal, brass,
 * squared corners and Bitter for display type. The sign-in card should read as
 * the staff entrance to the same building as the buyer-facing pages.
 */
export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
  },
  variables: {
    colorPrimary: 'hsl(183 31% 20%)',
    colorForeground: 'hsl(183 31% 18%)',
    colorMutedForeground: 'hsl(183 12% 42%)',
    colorDanger: 'hsl(0 60% 40%)',
    colorBackground: 'hsl(45 30% 98%)',
    colorInput: 'hsl(45 30% 98%)',
    colorInputForeground: 'hsl(183 31% 18%)',
    colorNeutral: 'hsl(43 16% 82%)',
    fontFamily: "'Source Sans 3', sans-serif",
    borderRadius: '0px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    // card/footer are !bg-transparent, so cardBox owns the only surface.
    cardBox:
      'bg-[hsl(45_30%_98%)] border border-[hsl(43_16%_82%)] rounded-none w-[440px] max-w-full overflow-hidden shadow-[0_24px_60px_-40px_hsl(183_31%_18%_/_0.45)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none px-8 pt-8',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    main: 'gap-5',
    headerTitle:
      "font-['Bitter',Georgia,serif] text-[26px] font-semibold tracking-[-.02em] text-[hsl(183_31%_18%)]",
    headerSubtitle: 'text-[14px] text-[hsl(183_12%_42%)]',
    socialButtonsBlockButton:
      'rounded-none border border-[hsl(43_16%_82%)] bg-transparent hover:border-[hsl(38_54%_48%)] hover:bg-[hsl(90_16%_87%)]',
    socialButtonsBlockButtonText:
      'text-[13px] font-semibold text-[hsl(183_31%_18%)]',
    dividerLine: 'bg-[hsl(43_16%_82%)]',
    dividerText:
      'text-[11px] font-bold uppercase tracking-[.14em] text-[hsl(183_12%_42%)]',
    formFieldLabel:
      'text-[11px] font-bold uppercase tracking-[.12em] text-[hsl(183_12%_42%)]',
    formFieldInput:
      'rounded-none border border-[hsl(43_16%_82%)] bg-[hsl(45_30%_98%)] text-[hsl(183_31%_18%)] focus:border-[hsl(38_54%_48%)]',
    formFieldRow: 'gap-2',
    formButtonPrimary:
      'rounded-none bg-[hsl(183_31%_20%)] text-[hsl(44_22%_95%)] text-[12px] font-bold uppercase tracking-[.1em] shadow-none hover:bg-[hsl(38_54%_48%)] hover:text-[hsl(183_31%_18%)]',
    footerAction: 'border-t border-[hsl(43_16%_82%)] bg-[hsl(44_22%_95%)]',
    footerActionText: 'text-[13px] text-[hsl(183_12%_42%)]',
    footerActionLink:
      'text-[13px] font-semibold text-[hsl(183_31%_20%)] hover:text-[hsl(38_54%_48%)]',
    identityPreviewEditButton: 'text-[hsl(183_31%_20%)]',
    formFieldSuccessText: 'text-[hsl(183_31%_20%)]',
    alert: 'rounded-none border border-[hsl(43_16%_82%)]',
    alertText: 'text-[13px] text-[hsl(183_31%_18%)]',
    otpCodeFieldInput:
      'rounded-none border border-[hsl(43_16%_82%)] text-[hsl(183_31%_18%)]',
  },
};
