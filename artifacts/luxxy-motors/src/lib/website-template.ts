import { resolveWebsiteTemplateId, type WebsiteTemplateId } from '@workspace/vehicle-meta';

export type CustomerWebsiteTemplate = Extract<WebsiteTemplateId, 'showroom' | 'grand-touring' | 'forecourt' | 'panorama'>;
const layouts = new Set<string>(['showroom', 'grand-touring', 'forecourt', 'panorama']);

export function isModernShowroom(presentation: { websiteTemplate?: unknown } | undefined): boolean {
  return presentation?.websiteTemplate === 'modern-showroom';
}

/** These four templates share the alternate catalogue renderer. */
export function selectedWebsiteTemplate(presentation: { websiteTemplate?: unknown } | undefined): CustomerWebsiteTemplate | null {
  const id = resolveWebsiteTemplateId(presentation?.websiteTemplate);
  return layouts.has(id) ? id as CustomerWebsiteTemplate : null;
}
