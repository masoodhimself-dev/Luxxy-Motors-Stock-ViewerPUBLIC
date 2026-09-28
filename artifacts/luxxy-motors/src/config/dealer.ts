import type { DealerBrochure, DealerOnlineReservation, DealerPresentation } from "@workspace/api-client-react";
export interface DealerConfig {
  brochure?: DealerBrochure;
  presentation?: DealerPresentation;
  onlineReservation?: DealerOnlineReservation;
  identity: {
    name: string;
    logoText?: string;
    logoAsset?: string;
    brandColors?: {
      primaryHsl?: string;
      accentHsl?: string;
    };
  };
  contact: {
    phone?: string;
    whatsapp?: string;
    email?: string;
  };
  address?: {
    street?: string;
    city?: string;
    region?: string;
    postcode?: string;
    mapsUrl?: string;
  };
  hours?: Array<{ days: string; times: string }>;
  legal: {
    companyName?: string;
    companyNumber?: string;
    vatNumber?: string;
    termsUrl?: string;
    privacyUrl?: string;
    cookieUrl?: string;
  };
  social: {
    instagram?: string;
    facebook?: string;
    twitter?: string;
  };
  hero: {
    announcement?: string;
    copy: string;
    subcopy: string;
    primaryCta: string;
    secondaryCta: string;
  };
  featuredVehicleIds?: string[];
  warranty?: {
    enabled: boolean;
    title: string;
    description: string;
    ctaLabel: string;
  };
  delivery?: {
    enabled: boolean;
    title: string;
    description: string;
    ctaLabel: string;
  };
  partExchange?: {
    enabled: boolean;
    title: string;
    description: string;
    ctaLabel: string;
  };
  bookViewing: {
    title: string;
    description: string;
    ctaLabel: string;
  };
  recentHandovers: {
    enabled: boolean;
    count: number;
  };
  trustItems: string[];
  reviews?: {
    link?: string;
    data?: Array<{ author: string; rating: number; text: string }>;
  };
  whyBuy?: Array<{ title: string; description: string }>;
}

export const dealerConfig: DealerConfig = {
  onlineReservation: { enabled: false, depositPence: 10000, terms: "" },
  identity: {
    name: "Luxxy Motors",
    logoText: "LUXXY MOTORS",
    brandColors: {
      primaryHsl: "195 22% 13%",
      accentHsl: "190 86% 44%",
    },
  },
  contact: {
    phone: "02084729917",
    whatsapp: "+447388831790",
  },
  address: {
    city: "Harrow",
    region: "London",
  },
  legal: {
    companyName: "Luxxy Motors",
  },
  social: {},
  hero: {
    copy: "Find your next car.",
    subcopy: "Independent used-car dealership in Harrow. Browse our stock and book a test drive.",
    primaryCta: "Browse cars",
    secondaryCta: "Enquire",
  },
  featuredVehicleIds: [],
  warranty: {
    enabled: true,
    title: "Warranty",
    description: "Warranty options are available on eligible vehicles.",
    ctaLabel: "Learn About Warranty",
  },
  delivery: {
    enabled: true,
    title: "Nationwide Delivery",
    description: "Customers may be able to have their vehicle delivered.",
    ctaLabel: "Ask About Delivery",
  },
  partExchange: {
    enabled: true,
    title: "Looking to part exchange your current car?",
    description: "Give us your registration and mileage and we’ll help you understand what your current car could be worth.",
    ctaLabel: "Value My Car",
  },
  bookViewing: {
    title: "Seen something you like?",
    description: "Book a test drive at a time that suits you.",
    ctaLabel: "Book a test drive",
  },
  recentHandovers: {
    enabled: false,
    count: 3,
  },
  trustItems: [
    "Warranty available",
    "Nationwide delivery",
    "Carefully selected vehicles",
    "Straightforward buying",
  ],
  whyBuy: [
    { title: "View it in person", description: "Choose a test-drive time and tell us which car you’d like to see." },
    { title: "The details upfront", description: "Check the price, mileage and specification before you travel. Ask us about anything you’d like clarified." },
    { title: "Your next steps", description: "Talk through the paperwork, payment and collection arrangements before you decide." },
  ]
};
