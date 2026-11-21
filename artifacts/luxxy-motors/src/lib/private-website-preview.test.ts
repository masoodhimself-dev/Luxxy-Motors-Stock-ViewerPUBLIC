import { expect, it } from 'vitest';
import { privateWebsitePreviewBase, privateWebsitePreviewDetails, previewPublicRequestPath, previewWebsiteAssetUrl, sharedWebsiteShowcaseRoute, websitePreviewBase } from './private-website-preview';

it.each(['grand-touring', 'modern-showroom', 'regent-lane'])('keeps the %s design and revision in every preview route and asset base', template => {
  const base = `/platform/preview/dealer-one/template/${template}/7`;
  window.history.replaceState(null, '', `${base}/cars/lexus-nx?fuel=Hybrid`);
  expect(privateWebsitePreviewBase()).toBe(base);
  expect(privateWebsitePreviewDetails()).toEqual({ dealerId: 'dealer-one', template, revision: 7 });
  expect(previewPublicRequestPath('/api/stock')).toBe(`${base}/api/stock`);
  const asset = '/api/website-assets/12345678-1234-1234-1234-123456789012';
  expect(previewWebsiteAssetUrl(`https://dealer.test${asset}`, 'https://dealer.test')).toBe(`${window.location.origin}${base}${asset}`);
  expect(previewWebsiteAssetUrl('/api/demo-logo?variant=footer', 'https://dealer.test')).toBe(`${window.location.origin}${base}/api/demo-logo?variant=footer`);
  window.history.replaceState(null, '', '/');
});

it('preserves ordinary private demos and does not interpret public query parameters as a template', () => {
  expect(privateWebsitePreviewBase('/platform/preview/demo-one/stock')).toBe('/platform/preview/demo-one');
  expect(privateWebsitePreviewDetails('/platform/preview/demo-one')).toEqual({ dealerId: 'demo-one', template: null, revision: null });
  expect(privateWebsitePreviewBase('/stock?template=forecourt')).toBe('');
  expect(privateWebsitePreviewBase('/portal')).toBe('');
  expect(privateWebsitePreviewBase('/platform/preview/demo-one/template/autodeal/3/stock')).toBe('/platform/preview/demo-one/template/autodeal/3');
  expect(privateWebsitePreviewDetails('/stock')).toBeNull();
});

it('routes the shared link and scopes a chosen design without interpreting it as an admin preview', () => {
  const chooser = `/showcase/${'aBc_12-'.repeat(10)}`;
  const base = `${chooser}/design/regent-lane`;
  expect(sharedWebsiteShowcaseRoute(chooser)).toEqual({ kind: 'chooser', base: chooser });
  expect(sharedWebsiteShowcaseRoute(`${chooser}/`)).toEqual({ kind: 'chooser', base: chooser });
  expect(sharedWebsiteShowcaseRoute(`${chooser}/design/unrecognised`)).toBeNull();
  expect(sharedWebsiteShowcaseRoute(`${chooser}/stock`)).toBeNull();
  expect(sharedWebsiteShowcaseRoute('/showcase/short')).toBeNull();
  window.history.replaceState(null, '', `${base}/cars/lexus-nx?from=stock`);
  try {
    expect(sharedWebsiteShowcaseRoute()).toEqual({ kind: 'design', base, chooser });
    expect(privateWebsitePreviewBase()).toBe('');
    expect(websitePreviewBase()).toBe(base);
    expect(previewPublicRequestPath('/api/stock')).toBe(`${base}/api/stock`);
    expect(previewWebsiteAssetUrl('/api/demo-logo?variant=footer', 'https://dealer.test')).toBe(`${window.location.origin}${base}/api/demo-logo?variant=footer`);
  } finally {
    window.history.replaceState(null, '', '/');
  }
});
