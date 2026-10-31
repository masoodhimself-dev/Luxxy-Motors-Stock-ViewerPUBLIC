import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/dom';
import { readFileSync } from 'node:fs';
import { createVehicleSheetPdf, saveVehicleSheetPdf, vehicleSheetPdfFilename } from './pdf';

const { rasterize } = vi.hoisted(() => ({ rasterize: vi.fn() }));
vi.mock('html2canvas/dist/html2canvas.min.js?url&import', () => ({ default: '/assets/sheet-rasterizer.js' }));
const canonical = 'https://dealer.example.test/vehicle/00000000-0000-4000-8000-000000000123';
const png = 'data:image/png;base64,' + readFileSync('public/portal-icons/badge-96.png').toString('base64');
const bounds = { x: 0, y: 0, left: 0, top: 0, right: 210 * 96 / 25.4, bottom: 297 * 96 / 25.4, width: 210 * 96 / 25.4, height: 297 * 96 / 25.4, toJSON: () => ({}) };

function outputCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(bounds.width * 300 / 96); canvas.height = Math.floor(bounds.height * 300 / 96);
  vi.spyOn(canvas, 'toDataURL').mockReturnValue(png);
  return canvas;
}
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = reject;
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer), byte => String.fromCharCode(byte)).join(''));
    reader.readAsArrayBuffer(blob);
  });
}
let page: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = `<main class="lvs-host" data-lvs-status="ready"><article class="lvs-page"><h1>Example vehicle</h1><a class="lvs-url" href="${canonical}">View full vehicle details</a></article></main>`;
  page = document.querySelector<HTMLElement>('.lvs-page')!;
  vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(bounds);
  vi.spyOn(page.querySelector('a')!, 'getBoundingClientRect').mockReturnValue({ ...bounds, x: 50, y: 900, left: 50, top: 900, right: 350, bottom: 930, width: 300, height: 30 });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  Object.defineProperty(window, 'html2canvas', { configurable: true, value: rasterize, writable: true });
  rasterize.mockReset(); rasterize.mockImplementation(async () => outputCanvas());
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as Window & { html2canvas?: unknown }).html2canvas; document.querySelectorAll('script[data-lvs-pdf-renderer]').forEach(script => script.remove()); document.body.replaceChildren(); });

describe('vehicle sheet direct PDF export', () => {
  it('writes an actual single A4 PDF with a raster page, metadata and canonical clickable vehicle link', async () => {
    const blob = await createVehicleSheetPdf(document), pdf = await readBlob(blob);
    expect(blob.type).toBe('application/pdf');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.match(/\/Type \/Page\b/g)).toHaveLength(1);
    const box = pdf.match(/\/MediaBox \[([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\]/)!;
    expect(Number(box[1])).toBe(0); expect(Number(box[2])).toBe(0);
    expect(Number(box[3]) * 25.4 / 72).toBeCloseTo(210, 2); expect(Number(box[4]) * 25.4 / 72).toBeCloseTo(297, 2);
    expect(pdf).toContain('/Subtype /Image'); expect(pdf).toContain('/Title (Vehicle details)');
    expect(pdf).toContain(`/URI (${canonical})`);
    expect(rasterize).toHaveBeenCalledWith(page, expect.objectContaining({ backgroundColor: '#ffffff', scale: 300 / 96, allowTaint: false, useCORS: true }));
    expect(page.querySelector('a')!.href).toBe(canonical);
    expect(page.closest('main')!.dataset.lvsStatus).toBe('ready');
  });

  it('normalises the make-model-registration download name without paths or unsafe characters', () => {
    expect(vehicleSheetPdfFilename('Škoda Octavia / AB12 XYZ.pdf')).toBe('skoda-octavia-ab12-xyz.pdf');
    expect(vehicleSheetPdfFilename('../../Honda CR-V\u0000/AB12 XYZ.PDF')).toBe('honda-cr-v-ab12-xyz.pdf');
    expect(vehicleSheetPdfFilename('...')).toBe('vehicle-details.pdf');
    expect(vehicleSheetPdfFilename('x'.repeat(250))).toHaveLength(104);
  });

  it('loads the rasterizer in the isolated sheet document so fonts and baseline metrics never use parent invoice fonts', async () => {
    const iframe = document.createElement('iframe'); document.body.appendChild(iframe);
    const isolated = iframe.contentDocument!; isolated.body.innerHTML = page.closest('main')!.outerHTML;
    const isolatedPage = isolated.querySelector<HTMLElement>('.lvs-page')!;
    vi.spyOn(isolatedPage, 'getBoundingClientRect').mockReturnValue(bounds);
    Object.defineProperty(isolated, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    const originalFonts = document.fonts;
    const renderIsolated = vi.fn(async () => outputCanvas());
    const pending = createVehicleSheetPdf(isolated);
    await waitFor(() => expect(isolated.querySelector('script[data-lvs-pdf-renderer]')).not.toBeNull());
    const script = isolated.querySelector<HTMLScriptElement>('script[data-lvs-pdf-renderer]')!;
    expect(script.ownerDocument).toBe(isolated); expect(script.src).toContain('/assets/sheet-rasterizer.js');
    Object.defineProperty(isolated.defaultView!, 'html2canvas', { configurable: true, value: renderIsolated });
    script.dispatchEvent(new Event('load'));
    expect((await pending).type).toBe('application/pdf');
    expect(renderIsolated).toHaveBeenCalledWith(isolatedPage, expect.any(Object));
    expect(rasterize).not.toHaveBeenCalled(); expect(document.fonts).toBe(originalFonts);
    iframe.remove();
  });

  it('loads and verifies the clone’s own regular, bold and plate fonts before raster drawing', async () => {
    const plate = document.createElement('span'); plate.className = 'lvs-plate'; page.appendChild(plate);
    const load = vi.fn().mockResolvedValue([{}]), check = vi.fn().mockReturnValue(true);
    rasterize.mockImplementation(async (_page, options) => {
      const clone = document.implementation.createHTMLDocument(); clone.body.innerHTML = page.outerHTML;
      Object.defineProperty(clone, 'fonts', { configurable: true, value: { ready: Promise.resolve(), load, check } });
      await options.onclone(clone);
      expect(load).toHaveBeenCalledWith('400 10pt "LuxxySheetSans"');
      expect(load).toHaveBeenCalledWith('700 10pt "LuxxySheetSans"');
      expect(load).toHaveBeenCalledWith('400 18pt "LuxxySheetPlate"');
      expect(check).toHaveBeenCalledTimes(3);
      return outputCanvas();
    });
    await createVehicleSheetPdf(document);
    expect((document.fonts as unknown as { load?: unknown }).load).toBeUndefined();
  });

  it('blocks unprepared or overflowed sheets before rasterising', async () => {
    page.closest('main')!.dataset.lvsStatus = 'measuring';
    await expect(createVehicleSheetPdf(document)).rejects.toThrow('not ready');
    page.closest('main')!.dataset.lvsStatus = 'ready';
    vi.mocked(page.getBoundingClientRect).mockReturnValue({ ...bounds, height: 1500 });
    await expect(createVehicleSheetPdf(document)).rejects.toThrow('does not fit one A4 page');
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('rejects incomplete photographs rather than silently exporting a missing image', async () => {
    page.appendChild(document.createElement('img'));
    await expect(createVehicleSheetPdf(document)).rejects.toThrow('could not be downloaded');
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('inlines already-loaded images in the cloned sheet without changing original image sources', async () => {
    const image = document.createElement('img'); image.src = 'https://images.example.test/car.jpg'; image.srcset = 'https://images.example.test/car-large.jpg 2x'; image.crossOrigin = 'anonymous'; page.appendChild(image);
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1200 }, naturalHeight: { value: 800 }, decode: { value: vi.fn().mockResolvedValue(undefined) } });
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ ...bounds, width: 400, height: 266 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
    rasterize.mockImplementation(async (_page, options) => {
      const clone = document.implementation.createHTMLDocument(); clone.body.innerHTML = page.outerHTML;
      Object.defineProperty(clone, 'fonts', { configurable: true, value: { ready: Promise.resolve(), load: vi.fn().mockResolvedValue([{}]), check: vi.fn().mockReturnValue(true) } });
      let finishDecode: () => void = () => {};
      const copied = clone.querySelector('img')!, decode = vi.fn(() => new Promise<void>(resolve => { finishDecode = resolve; }));
      Object.defineProperties(copied, { complete: { value: true }, naturalWidth: { value: 1200 }, naturalHeight: { value: 800 }, decode: { value: decode } });
      let cloneReady = false;
      const prepared = options.onclone(clone).then(() => { cloneReady = true; });
      await waitFor(() => expect(decode).toHaveBeenCalledOnce());
      expect(cloneReady).toBe(false);
      finishDecode(); await prepared;
      expect(decode).toHaveBeenCalledOnce();
      expect(copied.src).toBe(png); expect(copied.hasAttribute('srcset')).toBe(false); expect(copied.hasAttribute('crossorigin')).toBe(false);
      return outputCanvas();
    });
    await createVehicleSheetPdf(document);
    expect(image.src).toBe('https://images.example.test/car.jpg'); expect(image.srcset).toContain('car-large.jpg');
  });

  it('requests only the bounded same-origin car photo route and blocks unreadable photographs', async () => {
    const image = document.createElement('img'); image.src = 'https://images.example.test/private-origin-policy.jpg'; page.appendChild(image);
    Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1200 }, naturalHeight: { value: 800 }, decode: { value: vi.fn().mockResolvedValue(undefined) } });
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({ ...bounds, width: 400, height: 266 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => { throw new DOMException('Tainted source', 'SecurityError'); });
    const request = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', request);
    await expect(createVehicleSheetPdf(document)).rejects.toThrow('could not be downloaded');
    const requested = new URL(request.mock.calls[0][0]);
    expect(requested.origin).toBe(window.location.origin);
    expect(requested.pathname).toBe('/api/vehicles/00000000-0000-4000-8000-000000000123/sheet-image');
    expect(requested.searchParams.get('source')).toBe(image.src);
    expect(request).toHaveBeenCalledWith(requested.href, expect.objectContaining({ credentials: 'same-origin' }));
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('blocks a changed sheet after preparation without downloading stale data', async () => {
    rasterize.mockImplementation(async () => { page.closest('main')!.dataset.lvsStatus = 'preparing'; return outputCanvas(); });
    await expect(createVehicleSheetPdf(document)).rejects.toThrow('not ready');
  });

  it('honours cancellation before rendering and while waiting for document fonts', async () => {
    const early = new AbortController(); early.abort();
    await expect(createVehicleSheetPdf(document, early.signal)).rejects.toMatchObject({ name: 'AbortError' });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } });
    const waiting = new AbortController(), promise = createVehicleSheetPdf(document, waiting.signal);
    waiting.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('times out stalled preparation and hides internal asset or rendering error details', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } });
    const stalled = expect(createVehicleSheetPdf(document)).rejects.toThrow('could not be downloaded');
    await vi.advanceTimersByTimeAsync(30_000); await stalled;
    vi.useRealTimers();
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
    rasterize.mockRejectedValue(new Error('Private asset URL and provider internals'));
    await expect(createVehicleSheetPdf(document)).rejects.toThrow(/^The vehicle sheet could not be downloaded\./);
  });

  it('preserves monochrome output because canvas rendering does not implement CSS image filters', async () => {
    page.classList.add('lvs-mono');
    const canvas = outputCanvas(), pixels = { data: new Uint8ClampedArray([255, 0, 0, 255]) }, putImageData = vi.fn();
    vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData: () => pixels, putImageData } as unknown as CanvasRenderingContext2D);
    rasterize.mockResolvedValue(canvas);
    await createVehicleSheetPdf(document);
    expect([...pixels.data]).toEqual([54, 54, 54, 255]); expect(putImageData).toHaveBeenCalledWith(pixels, 0, 0);
  });

  it('triggers a safe browser download and releases the temporary blob URL after Safari can read it', async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:vehicle-sheet-test'), revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    let downloaded: { filename: string; href: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { downloaded = { filename: this.download, href: this.href }; });
    await saveVehicleSheetPdf(document, 'Honda CR-V / AB12 XYZ');
    expect(downloaded).toEqual({ filename: 'honda-cr-v-ab12-xyz.pdf', href: 'blob:vehicle-sheet-test' });
    expect(document.querySelector('a[download]')).toBeNull(); expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000); expect(revokeObjectURL).toHaveBeenCalledWith('blob:vehicle-sheet-test');
  });

  it('cleans up the temporary download if the browser rejects saving', async () => {
    const revokeObjectURL = vi.fn();
    Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:rejected-vehicle-sheet') });
    Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('Browser-specific private error'); });
    await expect(saveVehicleSheetPdf(document, 'Honda CR-V')).rejects.toThrow(/^The vehicle sheet could not be downloaded\./);
    expect(document.querySelector('a[download]')).toBeNull(); expect(revokeObjectURL).toHaveBeenCalledWith('blob:rejected-vehicle-sheet');
  });
});
