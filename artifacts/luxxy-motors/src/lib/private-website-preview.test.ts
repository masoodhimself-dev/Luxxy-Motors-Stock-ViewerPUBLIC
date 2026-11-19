import { expect, it } from 'vitest';
import { privateWebsitePreviewBase, privateWebsitePreviewDetails, previewPublicRequestPath, previewWebsiteAssetUrl } from './private-website-preview';

it.each(['grand-touring', 'modern-showroom'])('keeps the %s design and revision in every preview route and asset base', template => {
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
  expect(privateWebsitePreviewDetails('/stock')).toBeNull();
});
