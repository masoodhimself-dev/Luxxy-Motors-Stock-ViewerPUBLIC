/** Shared identifiers for published customer websites and private template previews. */
export const WEBSITE_TEMPLATES = [
  { id: 'existing', name: 'Original website', description: 'Keep the original website layout.', legacy: true },
  { id: 'classic', name: 'Classic', description: 'The previously available classic layout.', legacy: true },
  { id: 'premium', name: 'Premium', description: 'The previously available premium layout.', legacy: true },
  { id: 'focused', name: 'Focused', description: 'The previously available focused layout.', legacy: true },
  { id: 'showroom', name: 'Showroom', description: 'A clear showroom with large photographs and straightforward car details.', legacy: false },
  { id: 'grand-touring', name: 'Grand Touring', description: 'A navy and silver catalogue with large photographs and clear car details.', legacy: false },
  { id: 'forecourt', name: 'Forecourt', description: 'A practical stock catalogue with clear prices, facts and next steps.', legacy: false },
  { id: 'panorama', name: 'Panorama', description: 'An open, photographic layout that gives each car room.', legacy: false },
] as const;

export type WebsiteTemplateId = typeof WEBSITE_TEMPLATES[number]['id'];
export type WebsiteTemplateDefinition = typeof WEBSITE_TEMPLATES[number];

export function isWebsiteTemplateId(value: unknown): value is WebsiteTemplateId {
  return typeof value === 'string' && WEBSITE_TEMPLATES.some(template => template.id === value);
}

/** Missing or unrecognised historical values keep the original website. Never writes settings. */
export function resolveWebsiteTemplateId(value: unknown): WebsiteTemplateId {
  return isWebsiteTemplateId(value) ? value : 'existing';
}

export function websiteTemplateDefinition(value: unknown): WebsiteTemplateDefinition {
  const id = resolveWebsiteTemplateId(value);
  return WEBSITE_TEMPLATES.find(template => template.id === id)!;
}
