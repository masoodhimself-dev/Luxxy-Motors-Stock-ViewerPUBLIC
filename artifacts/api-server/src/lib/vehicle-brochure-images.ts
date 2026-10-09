import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { BrochurePhoto, LoadedPhoto } from './vehicle-brochure';

const blocked = new BlockList();
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['192.0.2.0', 24], ['198.51.100.0', 24], ['203.0.113.0', 24]] as const) blocked.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16]] as const) blocked.addSubnet(network, prefix, 'ipv6');

export function isPublicImageAddress(address: string): boolean {
  const family = isIP(address);
  // Only globally routed IPv6; this also excludes mapped IPv4 and transition ranges.
  if (family === 6 && !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  return family !== 0 && !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export function permittedBrochureImage(value: string, extraHosts = ''): URL | null {
  try {
    const url = new URL(value);
    const hosts = new Set(['m.atcdn.co.uk', 'images.autotrader.co.uk', 'cdn.images.autoexposure.co.uk', ...extraHosts.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)]);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || isIP(url.hostname) || !hosts.has(url.hostname.toLowerCase())) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

/** Inspect dimensions before handing compressed input to the PDF image decoder. */
export function imageDimensions(bytes: Buffer): { format: 'JPEG' | 'PNG'; width: number; height: number } | null {
  let dimensions: { format: 'JPEG' | 'PNG'; width: number; height: number } | null = null;
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    dimensions = { format: 'PNG', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xff) { offset++; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        dimensions = { format: 'JPEG', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
        break;
      }
      offset += length + 2;
    }
  }
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > 8192 || dimensions.height > 8192 || dimensions.width * dimensions.height > 20_000_000) return null;
  return dimensions;
}

async function downloadImage(url: URL, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    const abort = () => reject(new Error('Image download timed out'));
    signal.addEventListener('abort', abort, { once: true });
    lookup(url.hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !isPublicImageAddress(address))) throw new Error('Private image address');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    // Pin the validated DNS result; TLS still verifies the original hostname.
    const request = get(url, {
      signal,
      family: address.family,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
      headers: { Accept: 'image/jpeg, image/png', 'User-Agent': 'VehicleBrochure/1.0' },
    }, (response) => {
      if (response.statusCode !== 200 || !/^image\/(jpeg|png)(;|$)/i.test(String(response.headers['content-type'] || ''))) {
        response.destroy(); reject(new Error('Photograph unavailable')); return;
      }
      // Redirects are never followed, including redirects to an unapproved/private host.
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2_000_000) { request.destroy(new Error('Photograph too large')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

export async function loadBrochurePhotos(photos: BrochurePhoto[], extraHosts = ''): Promise<LoadedPhoto[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);
  const result: LoadedPhoto[] = photos.map((photo) => ({ ...photo }));
  let next = 0;
  let totalBytes = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(4, photos.length) }, async () => {
      while (next < photos.length && !controller.signal.aborted) {
        const index = next++;
        const url = permittedBrochureImage(photos[index].url, extraHosts);
        if (!url) continue;
        try {
          const bytes = await downloadImage(url, controller.signal);
          const dimensions = imageDimensions(bytes);
          totalBytes += bytes.length;
          if (dimensions && totalBytes <= 24_000_000) result[index] = { ...photos[index], bytes, ...dimensions };
          if (totalBytes > 24_000_000) controller.abort();
        } catch { /* Keep the labelled unavailable photograph instead of inventing or omitting it. */ }
      }
    }));
  } finally { clearTimeout(timer); }
  return result;
}
