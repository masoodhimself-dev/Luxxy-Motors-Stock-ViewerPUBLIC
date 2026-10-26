export const websiteTemplates = [
  { id: 'existing', name: 'Current website', description: 'Keep your existing layout and appearance.' },
  { id: 'classic', name: 'Classic Showroom', description: 'A balanced photograph and search, with clear vehicle cards.' },
  { id: 'premium', name: 'Premium', description: 'Larger photography and a spacious two-column catalogue.' },
  { id: 'focused', name: 'Stock Focused', description: 'Search first, with compact results and practical vehicle details.' },
] as const;

export type WebsiteTemplate = typeof websiteTemplates[number]['id'];

/** Omitted and unrecognised preferences preserve the existing website. */
export function resolveWebsiteTemplate(value: unknown): WebsiteTemplate {
  return websiteTemplates.some(template => template.id === value) ? value as WebsiteTemplate : 'existing';
}
