import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareWebsiteImage, validateWebsiteImageFile } from './website-image';

afterEach(() => vi.restoreAllMocks());
describe('website image preparation', () => {
  it.each(['image/svg+xml', 'image/heic', 'text/html', ''])('rejects unsupported %s files', type => {
    expect(() => validateWebsiteImageFile({ type, size: 100 })).toThrow('PNG, JPEG or WebP');
  });
  it('limits input size and accepts supported raster formats', () => {
    for (const size of [0, 21 * 1024 * 1024]) expect(() => validateWebsiteImageFile({ type: 'image/png', size })).toThrow('20 MB');
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(() => validateWebsiteImageFile({ type, size: 100 })).not.toThrow();
  });
  it.each(['logo', 'photo', 'icon'] as const)('resizes %s pixels, strips source metadata and cleans up browser resources', async kind => {
    const originalImage = globalThis.Image;
    vi.stubGlobal('Image', class { naturalWidth = 4000; naturalHeight = 2000; onload?: () => void; set src(_value: string) { queueMicrotask(() => this.onload?.()); } });
    const create = vi.fn(() => 'blob:fictional'), revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const drawing = { clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,clean');
    try {
      await prepareWebsiteImage(new File(['raw-exif-data'], 'private-location.jpg', { type: 'image/jpeg' }), kind);
      expect(encode).toHaveBeenCalledWith(kind === 'photo' ? 'image/jpeg' : 'image/png', 0.84);
      expect(drawing.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, kind === 'photo' ? 1920 : kind === 'icon' ? 256 : 1200, kind === 'photo' ? 960 : kind === 'icon' ? 128 : 600);
      expect(drawing.fillRect).toHaveBeenCalledTimes(kind === 'photo' ? 1 : 0);
      expect(revoke).toHaveBeenCalledWith('blob:fictional');
    } finally { vi.stubGlobal('Image', originalImage); }
  });
});
