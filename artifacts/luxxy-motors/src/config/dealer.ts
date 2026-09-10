export interface DealerConfig {
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
  identity: {
    name: "Luxxy Motors",
    logoText: "LUXXY MOTORS",
    brandColors: {
      primaryHsl: "222 47% 11%",
      accentHsl: "38 92% 50%",
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
    copy: "Carefully chosen cars.",
    subcopy: "Quality used vehicles. Straightforward buying. Exceptional service.",
    primaryCta: "Browse cars",
    secondaryCta: "Find my car",
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
    description: "Arrange a viewing at a time that suits you.",
    ctaLabel: "Book a Viewing",
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
    { title: "Quality Vehicles", description: "Carefully selected used vehicles." },
    { title: "Transparent Buying", description: "Clear vehicle information and straightforward pricing." },
    { title: "Warranty Options", description: "Warranty options available on eligible vehicles." },
    { title: "Customer Support", description: "Support throughout the purchase and handover process." },
  ]
};
