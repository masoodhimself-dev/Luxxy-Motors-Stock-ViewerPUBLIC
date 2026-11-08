export function privateWebsitePreviewBase(pathname = typeof window === 'undefined' ? '' : window.location.pathname) {
  return /^\/platform\/preview\/[a-z0-9][a-z0-9-]{1,62}(?=\/|$)/.exec(pathname)?.[0] ?? '';
}

export function previewPublicRequestPath(path: string) {
  return privateWebsitePreviewBase() + path;
}

export function previewWebsiteAssetUrl(value: string, dealerOrigin: string | undefined) {
  const base = privateWebsitePreviewBase();
  if (!base) return value;
  try {
    const url = new URL(value, dealerOrigin || window.location.origin);
    const local = value.startsWith('/') && !value.startsWith('//');
    if (local || url.origin === dealerOrigin) {
      const asset = /^\/api\/website-assets\/[a-f0-9-]{36}$/i.test(url.pathname);
      const demoLogo = url.pathname === '/api/demo-logo';
      if (asset || demoLogo) {
        const variant = demoLogo && url.searchParams.get('variant') === 'footer' ? '?variant=footer' : '';
        return window.location.origin + base + url.pathname + variant;
      }
    }
  } catch { /* Preserve the existing value if this is not a website asset URL. */ }
  return value;
}
