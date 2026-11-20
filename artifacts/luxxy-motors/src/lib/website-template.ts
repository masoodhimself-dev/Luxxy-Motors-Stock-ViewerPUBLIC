import { resolveWebsiteTemplateId, type WebsiteTemplateId } from '@workspace/vehicle-meta';

export type CustomerWebsiteTemplate = Extract<WebsiteTemplateId, 'showroom' | 'grand-touring' | 'forecourt' | 'autodeal' | 'panorama'>;
const layouts = new Set<string>(['showroom', 'grand-touring', 'forecourt', 'autodeal', 'panorama']);

export function isModernShowroom(presentation: { websiteTemplate?: unknown } | undefined): boolean {
  return presentation?.websiteTemplate === 'modern-showroom';
}

/** Opted-in designs with their own customer layouts and theme. */
export function selectedWebsiteTemplate(presentation: { websiteTemplate?: unknown } | undefined): CustomerWebsiteTemplate | null {
  const id = resolveWebsiteTemplateId(presentation?.websiteTemplate);
  return layouts.has(id) ? id as CustomerWebsiteTemplate : null;
}
