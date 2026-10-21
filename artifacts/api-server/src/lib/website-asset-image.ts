import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export const websiteAssetLimits = Object.freeze({ bytes: 2 * 1024 * 1024, side: 4096, pixels: 12_000_000, dealerBytes: 50 * 1024 * 1024, dealerCount: 100, concurrentDecodes: 2 });
export type WebsiteAssetMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type NormalisedWebsiteImage = { bytes: Buffer; mimeType: WebsiteAssetMime; width: number; height: number; digest: string; requestHash: string };
export class WebsiteAssetError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = 'INVALID_WEBSITE_IMAGE') { super(message); }
}
const invalid = () => new WebsiteAssetError('Choose a valid PNG, JPEG or WebP image.');
function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > websiteAssetLimits.side || height > websiteAssetLimits.side || width * height > websiteAssetLimits.pixels) {
    throw new WebsiteAssetError('Resize this image to at most 4096 pixels on either side and 12 megapixels.');
  }
  return { width, height };
}

/** Read only bounded raster headers before asking a native decoder to allocate pixels. */
export function websiteImageHeader(bytes: Buffer, mimeType: WebsiteAssetMime) {
  if (mimeType === 'image/png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') throw invalid();
    let offset = 8, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
      if (end > bytes.length) throw invalid();
      const kind = bytes.toString('ascii', offset + 4, offset + 8);
      if (kind === 'acTL') throw new WebsiteAssetError('Choose a still image rather than an animated image.');
      offset = end;
      if (kind === 'IEND') { if (length !== 0 || end !== bytes.length) throw invalid(); ended = true; break; }
    }
    if (!ended) throw invalid();
    return dimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (mimeType === 'image/jpeg') {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) throw invalid();
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) throw invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 0 || marker === 216 || marker === 217 || marker === 218 || (marker >= 208 && marker <= 215) || offset + 2 > bytes.length) throw invalid();
      const length = bytes.readUInt16BE(offset), end = offset + length;
      if (length < 2 || end > bytes.length) throw invalid();
      if ([192, 193, 194].includes(marker)) {
        if (length < 8 || bytes[offset + 2] !== 8) throw invalid();
        return dimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      }
      // Reject less common arithmetic/lossless JPEG modes instead of guessing dimensions.
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) throw invalid();
      offset = end;
    }
    throw invalid();
  }
  if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
  let offset = 12, frame: { width: number; height: number } | undefined, canvas: typeof frame;
  while (offset + 8 <= bytes.length) {
    const kind = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + size;
    if (end > bytes.length) throw invalid();
    if (kind === 'ANIM' || kind === 'ANMF') throw new WebsiteAssetError('Choose a still image rather than an animated image.');
    if (kind === 'VP8X') {
      if (size !== 10 || canvas || (bytes[start]! & 2)) throw invalid();
      canvas = dimensions(bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1);
    }
    if (kind === 'VP8 ') {
      if (frame || size < 10 || (bytes[start]! & 1) || bytes.toString('hex', start + 3, start + 6) !== '9d012a') throw invalid();
      frame = dimensions(bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff);
    }
    if (kind === 'VP8L') {
      if (frame || size < 5 || bytes[start] !== 47) throw invalid();
      const bits = bytes.readUInt32LE(start + 1);
      if (bits >>> 29) throw invalid();
      frame = dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    offset = end + (size % 2);
  }
  if (offset !== bytes.length || !frame || (canvas && (canvas.width !== frame.width || canvas.height !== frame.height))) throw invalid();
  return frame;
}

let activeDecodes = 0;
/** The decoder receives bytes only: it can never fetch a supplied URL or local filename. */
export async function normaliseWebsiteImage(dataUrl: string): Promise<NormalisedWebsiteImage> {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(websiteAssetLimits.bytes / 3) * 4 + 32) throw new WebsiteAssetError('Choose a compressed image under 2 MB.', 413, 'WEBSITE_IMAGE_TOO_LARGE');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2]!.length % 4 !== 0) throw invalid();
  const mimeType = match[1] as WebsiteAssetMime, bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.length < 12 || bytes.length > websiteAssetLimits.bytes || bytes.toString('base64') !== match[2]) throw invalid();
  const expected = websiteImageHeader(bytes, mimeType);
  if (activeDecodes >= websiteAssetLimits.concurrentDecodes) throw new WebsiteAssetError('Other images are being prepared. Try again in a moment.', 429, 'WEBSITE_IMAGE_BUSY');
  activeDecodes++;
  try {
    const decoded = await loadImage(bytes);
    const size = dimensions(decoded.width, decoded.height);
    // JPEG EXIF orientation may legitimately exchange the two axes.
    if (size.width * size.height !== expected.width * expected.height || !((size.width === expected.width && size.height === expected.height) || (mimeType === 'image/jpeg' && size.width === expected.height && size.height === expected.width))) throw invalid();
    const canvas = createCanvas(size.width, size.height);
    canvas.getContext('2d').drawImage(decoded, 0, 0);
    // Drawing pixels onto a fresh canvas removes EXIF/GPS, comments and embedded payloads.
    const canonical = mimeType === 'image/png' ? await canvas.encode('png') : await canvas.encode(mimeType === 'image/jpeg' ? 'jpeg' : 'webp', 90);
    if (canonical.length > websiteAssetLimits.bytes) throw new WebsiteAssetError('This image is too large after processing. Resize it or choose a more compressed image.', 413, 'WEBSITE_IMAGE_TOO_LARGE');
    return { bytes: canonical, mimeType, ...size, digest: createHash('sha256').update(canonical).digest('hex'), requestHash: createHash('sha256').update(mimeType).update(bytes).digest('hex') };
  } catch (error) {
    if (error instanceof WebsiteAssetError) throw error;
    throw invalid();
  } finally { activeDecodes--; }
}
