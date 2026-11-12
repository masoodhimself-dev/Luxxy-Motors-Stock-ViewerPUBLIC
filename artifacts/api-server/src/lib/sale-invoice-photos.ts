import { createCanvas, loadImage } from '@napi-rs/canvas';
import { imageDimensions, loadBrochurePhotos, permittedBrochureImage } from './vehicle-brochure-images';

const candidateLimit = 5;
const photoLimit = 3;
const maximumPhotoBytes = 180_000;

/** Input URLs must come from the saved car's own stock record and gallery. */
export async function loadSaleInvoicePhotos(
  urls: readonly unknown[],
  extraHosts = process.env.VEHICLE_PDF_IMAGE_HOSTS ?? '',
  load = loadBrochurePhotos,
): Promise<string[]> {
  const candidates = new Set<string>();
  for (const value of urls) {
    if (typeof value !== 'string') continue;
    const url = permittedBrochureImage(value, extraHosts);
    if (!url) continue;
    // Auto Trader can provide a print-sized variant. Keep other approved paths intact.
    if (url.hostname === 'm.atcdn.co.uk' || url.hostname === 'images.autotrader.co.uk') {
      url.pathname = url.pathname.replace(/\bw\d+-h\d+\b/,'w720-h540');
    }
    candidates.add(url.href);
    if (candidates.size >= candidateLimit) break;
  }
  if (!candidates.size) return [];
  const loaded = await load([...candidates].map(url=>({url,caption:''})),extraHosts,4000);
  const photos = new Set<string>();
  for (const { bytes } of loaded) {
    if (!bytes?.length || bytes.length > 2_000_000) continue;
    try {
      const input = Buffer.from(bytes);
      const dimensions = imageDimensions(input);
      if (!dimensions || dimensions.width * dimensions.height > 12_000_000) continue;
      const image = await loadImage(input);
      if (!Number.isInteger(image.width) || !Number.isInteger(image.height) ||
        image.width * image.height !== dimensions.width * dimensions.height ||
        !((image.width === dimensions.width && image.height === dimensions.height) ||
          (image.width === dimensions.height && image.height === dimensions.width))) continue;
      const scale = Math.min(1,720 / Math.max(image.width,image.height));
      const canvas = createCanvas(Math.max(1,Math.round(image.width*scale)),Math.max(1,Math.round(image.height*scale)));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const jpeg = await canvas.encode('jpeg',78);
      if (jpeg.length && jpeg.length <= maximumPhotoBytes) photos.add(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
      if (photos.size >= photoLimit) break;
    } catch { /* Invalid optional photographs are omitted. */ }
  }
  return [...photos];
}
