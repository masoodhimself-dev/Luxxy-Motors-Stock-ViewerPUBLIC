import { resolveWebsiteTemplateId, type WebsiteTemplateId } from '@workspace/vehicle-meta/website-templates';

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function publishedWebsiteTemplate(config: unknown): WebsiteTemplateId {
  return resolveWebsiteTemplateId(object(object(config).presentation).websiteTemplate);
}

/** Change one presentation field, preserving private and unfamiliar settings verbatim. */
export function withWebsiteTemplate(config: Record<string, unknown>, template: WebsiteTemplateId): Record<string, unknown> {
  return { ...structuredClone(config), presentation: { ...structuredClone(object(config.presentation)), websiteTemplate: template } };
}
