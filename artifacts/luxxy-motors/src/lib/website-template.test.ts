import { describe, expect, it } from 'vitest';
import { selectedWebsiteTemplate } from './website-template';

describe('opt-in customer website templates', () => {
  it.each([undefined, {}, { websiteTemplate: 'existing' }, { websiteTemplate: 'classic' }, { websiteTemplate: 'premium' }, { websiteTemplate: 'focused' }, { websiteTemplate: 'unknown' }, { websiteTemplate: null }])('preserves the established website for %j', presentation => {
    expect(selectedWebsiteTemplate(presentation)).toBeNull();
  });
  it.each(['showroom', 'grand-touring', 'forecourt', 'autodeal', 'panorama'] as const)('selects only the explicit published %s layout', id => {
    expect(selectedWebsiteTemplate({ websiteTemplate: id })).toBe(id);
  });
});
