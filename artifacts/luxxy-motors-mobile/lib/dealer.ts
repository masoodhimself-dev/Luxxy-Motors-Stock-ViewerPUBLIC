export const dealer = {
  name: 'Luxxy Motors',
  shortName: 'LUXXY',
  phone: '02084729917',
  whatsapp: '+447388831790',
  email: undefined as string | undefined,
  location: 'Harrow, London',
  address: 'Harrow, London',
  mapsUrl: undefined as string | undefined,
  trustItems: [
    'Warranty available',
    'Nationwide delivery',
    'Carefully selected vehicles',
  ],
  services: [
    { type: 'delivery' as const, title: 'Nationwide delivery', description: 'Ask about getting your next car delivered.' },
    { type: 'warranty' as const, title: 'Warranty options', description: 'Available on eligible vehicles.' },
    { type: 'part_exchange' as const, title: 'Part-exchange valuation', description: 'Tell us about your current car.' },
  ],
} as const;

export type EnquiryServiceType = 'general' | 'delivery' | 'warranty' | 'part_exchange';