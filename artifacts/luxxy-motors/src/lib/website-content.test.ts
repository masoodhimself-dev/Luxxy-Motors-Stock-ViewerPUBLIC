import { describe, expect, it } from 'vitest';
import { websiteFields, websiteText } from './website-content';
describe('dealer page wording', () => {
  it('uses defaults for legacy settings and blank overrides', () => {
    expect(websiteText({}, 'stockTitle')).toBe('Browse Stock');
    expect(websiteText({ presentation: { websiteCopy: { stockTitle: '  ' } } }, 'stockTitle')).toBe('Browse Stock');
  });
  it('uses the dealership wording and keeps a unique content inventory', () => {
    expect(websiteText({ presentation: { websiteCopy: { stockTitle: ' Our cars ' } } }, 'stockTitle')).toBe('Our cars');
    expect(new Set(websiteFields.map(field => field.key)).size).toBe(websiteFields.length);
  });
});
