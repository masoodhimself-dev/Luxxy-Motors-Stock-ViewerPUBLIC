import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { SaleWorkspaceBranding } from '@workspace/vehicle-meta';
import { websiteAssetLimits, websiteImageHeader, type WebsiteAssetMime } from './website-asset-image';
import { builtInMultiChoiceLogoPath, builtInMultiChoiceLogoPngDataUrl } from './built-in-invoice-logo';
import { currentTenant } from './tenant-context';

type LogoReadClient = { query: (text: string, parameters?: any[]) => Promise<{ rows: Record<string, any>[] }> };
const assetPath = /^\/api\/website-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// Both invoice renderers accept embedded raster data below 1.5 million characters.
const pdfDataUrlLimit = 1_500_000;

function usesShippedMultiChoiceLogo(dealerId: string, canonicalOrigin: string) {
  const tenant = currentTenant();
  if (!tenant || tenant.dealerId !== dealerId) return false;
  try {
    const url = new URL(canonicalOrigin), tenantUrl = new URL(tenant.canonicalOrigin);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash &&
      ['multichoicemotors.co.uk', 'www.multichoicemotors.co.uk'].includes(url.hostname) && tenantUrl.origin === url.origin && tenantUrl.pathname === '/' && !tenantUrl.search && !tenantUrl.hash && !tenantUrl.username && !tenantUrl.password;
  } catch { return false; }
}

function ownedAssetId(value: string, canonicalOrigin: string): string | undefined {
  const relative = assetPath.exec(value);
  if (relative) return relative[1];
  try {
    const origin = new URL(canonicalOrigin), url = new URL(value);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      url.origin !== origin.origin || url.username || url.password || url.search || url.hash) return undefined;
    return assetPath.exec(url.pathname)?.[1];
  } catch { return undefined; }
}

/** The native decoder receives bounded bytes, never a URL or local filename. */
async function pdfRaster(bytes: Buffer, mimeType: WebsiteAssetMime, originalDataUrl?: string): Promise<string> {
  if (!bytes.length || bytes.length > websiteAssetLimits.bytes) return '';
  try {
    const expected = websiteImageHeader(bytes, mimeType);
    const image = await loadImage(bytes);
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 ||
      image.width > websiteAssetLimits.side || image.height > websiteAssetLimits.side || image.width * image.height > websiteAssetLimits.pixels ||
      image.width * image.height !== expected.width * expected.height ||
      !((image.width === expected.width && image.height === expected.height) || (mimeType === 'image/jpeg' && image.width === expected.height && image.height === expected.width))) return '';
    const preserved = originalDataUrl ?? `data:${mimeType};base64,${bytes.toString('base64')}`;
    if (mimeType !== 'image/webp' && preserved.length < pdfDataUrlLimit) return preserved;
    // WebP needs a raster format the PDF renderer supports. Bound the print-sized
    // conversion too, so a small highly compressed source cannot bloat every invoice.
    let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    for (let attempt = 0; attempt < 5; attempt++, scale /= 2) {
      const canvas = createCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const png = await canvas.encode('png');
      const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
      if (dataUrl.length < pdfDataUrlLimit) return dataUrl;
    }
  } catch { /* Unusable optional branding uses the saved dealer name. */ }
  return '';
}

/**
 * Freeze the current dealership's immutable uploaded logo into a NEW document.
 * This is deliberately called only while issuing, never when reopening or resending
 * an issued document. No remote request is made and no supplied host is trusted.
 */
export async function embedInvoiceLogoAsset(branding: SaleWorkspaceBranding, dealerId: string, client: LogoReadClient, canonicalOrigin: string): Promise<SaleWorkspaceBranding> {
  const result: SaleWorkspaceBranding = { ...branding, identity: { ...branding.identity, logoAsset: '' } };
  const value = branding.identity.logoAsset;
  if (branding.invoiceSettings?.showLogo === false) return result;
  // The public header deliberately uses this official logo for this verified
  // tenant domain. Match it even when old settings still contain an empty or
  // superseded asset. Names and global fallback domains never select a brand.
  if (usesShippedMultiChoiceLogo(dealerId, canonicalOrigin)) {
    result.identity.logoAsset = builtInMultiChoiceLogoPngDataUrl;
    return result;
  }
  if (typeof value !== 'string' || !value) return result;
  // The only shipped static logo. Its exact source SVG was rasterised at build
  // time; this cannot turn an arbitrary filesystem path or URL into a read.
  if (value === builtInMultiChoiceLogoPath) {
    result.identity.logoAsset = builtInMultiChoiceLogoPngDataUrl;
    return result;
  }
  if (value.startsWith('data:')) {
    if (value.length > Math.ceil(websiteAssetLimits.bytes / 3) * 4 + 32) return result;
    const match = /^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!match || match[2]!.length % 4 !== 0) return result;
    const bytes = Buffer.from(match[2]!, 'base64');
    if (bytes.toString('base64') !== match[2]) return result;
    const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1] as WebsiteAssetMime;
    result.identity.logoAsset = await pdfRaster(bytes, mimeType, value.replace(/^data:image\/jpg;/, 'data:image/jpeg;'));
    return result;
  }
  const id = ownedAssetId(value, canonicalOrigin);
  if (!id) return result;
  // Keep the same transaction client used to freeze the rest of the document.
  const row = (await client.query("SELECT mime_type,byte_size,width,height,encode(bytes,'hex') AS bytes FROM dealer_website_assets WHERE dealer_id = $1 AND id = $2::uuid", [dealerId, id])).rows[0];
  if (!row || !['image/png', 'image/jpeg', 'image/webp'].includes(row.mime_type) || !Number.isSafeInteger(Number(row.byte_size)) || Number(row.byte_size) < 1 ||
    Number(row.byte_size) > websiteAssetLimits.bytes || typeof row.bytes !== 'string' || row.bytes.length !== Number(row.byte_size) * 2 || !/^[0-9a-f]+$/i.test(row.bytes)) return result;
  const bytes = Buffer.from(row.bytes, 'hex');
  try {
    const dimensions = websiteImageHeader(bytes, row.mime_type);
    if (dimensions.width !== Number(row.width) || dimensions.height !== Number(row.height)) return result;
  } catch { return result; }
  result.identity.logoAsset = await pdfRaster(bytes, row.mime_type);
  return result;
}
