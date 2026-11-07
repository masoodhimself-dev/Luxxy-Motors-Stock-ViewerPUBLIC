import { publicDealershipOrigin } from './public-dealership-url';

const shoreDriveOrigins = ['https://shoredrive.uk', 'https://www.shoredrive.uk'];
const publishedAssets = {
  header: 'd01af3ae-0a7c-4711-83ab-0dec2e0e7a84',
  footer: 'f0c45054-168c-452c-a572-83327ac212a6',
};

export function isShoreDriveWebsite() {
  return typeof document !== 'undefined' && shoreDriveOrigins.includes(publicDealershipOrigin());
}

/** Use fitted vectors for Shore Drive's current published marks. New uploads take precedence. */
export function getFittedShoreDriveLogo(asset: string | undefined, placement: keyof typeof publishedAssets) {
  if (!asset || !isShoreDriveWebsite()) return;

  const publishedPath = `/api/website-assets/${publishedAssets[placement]}`;
  const validUrls = [publishedPath, ...shoreDriveOrigins.map(site => `${site}${publishedPath}`)];
  if (!validUrls.includes(asset.trim())) return;

  return placement === 'header'
    ? '/brand/shore-drive/shore-drive-wordmark.svg'
    : '/brand/shore-drive/shore-drive-wordmark-white.svg';
}
