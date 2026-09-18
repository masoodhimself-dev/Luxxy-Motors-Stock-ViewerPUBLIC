import type { DealerSettings } from '@workspace/api-client-react';
import { dealerConfig } from '../src/config/dealer';

// Complete API-shaped defaults for the read-only design preview.
export const previewSettings: DealerSettings = {
  presentation: {
    // With no separate showroom image, the introduction reuses the homepage photo.
    showroomImageUrl: "",
    showroomImageAlt: "",
    visitInstructions:
      "Sample visiting information: viewings by appointment. Choose a date and time online, or call the showroom before travelling.",
    parkingInstructions:
      "Sample arrival instructions: customer spaces beside the showroom entrance. Replace this with the arrangements at your dealership.",
    teamIntroduction:
      "Sample introduction: tell customers who they will meet, what your dealership specialises in and how you help them choose their next car.",
    includedInformation:
      "Sample handover information: confirm the documents, accessories and preparation included with your chosen vehicle before purchase.",
    reviewsUrl: "",
  },
  identity: {
    name: dealerConfig.identity.name,
    logoText: dealerConfig.identity.logoText || '',
    logoAsset: dealerConfig.identity.logoAsset || '',
    brandColors: {
      primaryHsl: dealerConfig.identity.brandColors?.primaryHsl || '218 39% 16%',
      accentHsl: dealerConfig.identity.brandColors?.accentHsl || '42 82% 49%',
    },
  },
  contact: {
    phone: dealerConfig.contact.phone || '',
    whatsapp: dealerConfig.contact.whatsapp || '',
    email: dealerConfig.contact.email || '',
  },
  address: {
    street: "12 Example Road (sample address)",
    city: dealerConfig.address?.city || '',
    region: dealerConfig.address?.region || '',
    postcode: "Sample postcode",
    mapsUrl: dealerConfig.address?.mapsUrl || '',
  },
  hours: [
    { days: "Monday – Friday", times: "09:00 – 18:00 (sample)" },
    { days: "Saturday", times: "09:00 – 17:00 (sample)" },
    { days: "Sunday", times: "By appointment (sample)" },
  ],
  legal: {
    companyName: dealerConfig.legal.companyName || '',
    companyNumber: dealerConfig.legal.companyNumber || '',
    vatNumber: dealerConfig.legal.vatNumber || '',
    termsUrl: dealerConfig.legal.termsUrl || '',
    privacyUrl: dealerConfig.legal.privacyUrl || '',
    cookieUrl: dealerConfig.legal.cookieUrl || '',
  },
  social: {
    instagram: dealerConfig.social.instagram || '',
    facebook: dealerConfig.social.facebook || '',
    twitter: dealerConfig.social.twitter || '',
  },
  hero: {
    announcement: dealerConfig.hero.announcement || '',
    copy: dealerConfig.hero.copy,
    subcopy: dealerConfig.hero.subcopy,
    primaryCta: dealerConfig.hero.primaryCta,
    secondaryCta: dealerConfig.hero.secondaryCta,
  },
  featuredVehicleIds: [],
  warranty: {
    enabled: dealerConfig.warranty?.enabled ?? true,
    title: dealerConfig.warranty?.title || 'Warranty',
    description: dealerConfig.warranty?.description || '',
    ctaLabel: dealerConfig.warranty?.ctaLabel || 'Learn more',
  },
  delivery: {
    enabled: dealerConfig.delivery?.enabled ?? true,
    title: dealerConfig.delivery?.title || 'Nationwide delivery',
    description: dealerConfig.delivery?.description || '',
    ctaLabel: dealerConfig.delivery?.ctaLabel || 'Ask about delivery',
  },
  partExchange: {
    enabled: dealerConfig.partExchange?.enabled ?? true,
    title: dealerConfig.partExchange?.title || 'Part exchange',
    description: dealerConfig.partExchange?.description || '',
    ctaLabel: dealerConfig.partExchange?.ctaLabel || 'Value my car',
  },
  bookViewing: {
    title: dealerConfig.bookViewing.title,
    description: dealerConfig.bookViewing.description,
    ctaLabel: dealerConfig.bookViewing.ctaLabel,
  },
  recentHandovers: {
    enabled: dealerConfig.recentHandovers?.enabled ?? false,
    count: dealerConfig.recentHandovers?.count ?? 3,
  },
  trustItems: [...dealerConfig.trustItems],
  whyBuy: (dealerConfig.whyBuy || []).map((item) => ({ ...item })),
};
