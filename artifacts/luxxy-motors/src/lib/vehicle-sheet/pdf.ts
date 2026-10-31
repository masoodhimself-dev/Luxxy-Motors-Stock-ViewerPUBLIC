import type html2canvas from 'html2canvas';
import html2canvasScriptUrl from 'html2canvas/dist/html2canvas.min.js?url&import';
import { loadFonts } from './assets';

const A4 = { width: 210, height: 297 };
const PIXELS_PER_MM = 96 / 25.4;
const EXPORT_SCALE = 300 / 96;
const EXPORT_TIMEOUT_MS = 30_000;
const EXPORT_ERROR = 'The vehicle sheet could not be downloaded. Please try again or use Print A4 sheet.';

export function vehicleSheetPdfFilename(value: string): string {
  const name = value.replace(/\.pdf$/i, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/g, '');
  return `${name || 'vehicle-details'}.pdf`;
}

function readyPage(doc: Document): HTMLElement {
  const page = doc.querySelector<HTMLElement>('.lvs-host[data-lvs-status="ready"] .lvs-page');
  if (!doc.defaultView || !page?.isConnected || doc.querySelectorAll('.lvs-page').length !== 1)
    throw new Error('The vehicle sheet is not ready. Please wait for the preview.');
  const frame = doc.defaultView.frameElement;
  if (doc.defaultView.closed || (frame && !frame.isConnected)) throw new Error(EXPORT_ERROR);
  const box = page.getBoundingClientRect();
  if (Math.abs(box.width - A4.width * PIXELS_PER_MM) > 1 || Math.abs(box.height - A4.height * PIXELS_PER_MM) > 1
    || page.scrollWidth > Math.ceil(box.width) + 1 || page.scrollHeight > Math.ceil(box.height) + 1)
    throw new Error('The vehicle sheet does not fit one A4 page. Please prepare the preview again.');
  return page;
}

function aborted(): Error { return new DOMException('Vehicle sheet download cancelled.', 'AbortError'); }

/** html2canvas uses its own global document for canvas font resolution AND
 * baseline metrics. Execute the installed standalone build in the sheet's
 * isolated iframe, never in the parent website/invoice document. */
async function sheetRasterizer(doc: Document, signal: AbortSignal): Promise<typeof html2canvas> {
  const view = doc.defaultView as (Window & { html2canvas?: typeof html2canvas }) | null;
  if (!view) throw new Error(EXPORT_ERROR);
  if (typeof view.html2canvas === 'function') return view.html2canvas;
  if (typeof html2canvasScriptUrl !== 'string' || !html2canvasScriptUrl.trim()) throw new Error(EXPORT_ERROR);
  const source = new URL(html2canvasScriptUrl, view.parent.location.href);
  if (!/^https?:$/.test(source.protocol) || source.origin !== view.parent.location.origin) throw new Error(EXPORT_ERROR);
  if (signal.aborted) throw aborted();
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = source.href; script.dataset.lvsPdfRenderer = 'true';
    const cleanup = () => { script.onload = script.onerror = null; signal.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); script.remove(); reject(aborted()); };
    script.onload = () => {
      cleanup();
      if (typeof view.html2canvas === 'function') resolve(view.html2canvas);
      else { script.remove(); reject(new Error(EXPORT_ERROR)); }
    };
    script.onerror = () => { cleanup(); script.remove(); reject(new Error(EXPORT_ERROR)); };
    signal.addEventListener('abort', cancel, { once: true });
    doc.head.appendChild(script);
  });
}

function blobDataUrl(blob: Blob, doc: Document): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new doc.defaultView!.FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error(EXPORT_ERROR));
    reader.onerror = () => reject(new Error(EXPORT_ERROR));
    reader.readAsDataURL(blob);
  });
}

/** Reuse decoded assets. The bounded same-origin route verifies an official
 * photo belongs to this tenant's current car; never export a missing photo. */
async function imageSnapshot(image: HTMLImageElement, doc: Document, signal: AbortSignal): Promise<string> {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) throw new Error(EXPORT_ERROR);
  if (image.decode) await image.decode();
  if (signal.aborted) throw aborted();
  const canvas = doc.createElement('canvas');
  const bounds = image.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight) * EXPORT_SCALE);
  canvas.width = Math.max(1, Math.ceil(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.ceil(image.naturalHeight * ratio));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(EXPORT_ERROR);
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } catch {
    const source = image.currentSrc || image.src;
    if (!/^https?:\/\//i.test(source)) throw new Error(EXPORT_ERROR);
    const vehicleUrl = new URL(doc.querySelector<HTMLAnchorElement>('.lvs-url[href]')?.href || '');
    const vehicleId = /^\/vehicle\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/?$/i.exec(vehicleUrl.pathname)?.[1];
    if (vehicleUrl.protocol !== 'https:' || vehicleUrl.username || vehicleUrl.password || !vehicleId) throw new Error(EXPORT_ERROR);
    const endpoint = new URL(`/api/vehicles/${vehicleId}/sheet-image`, doc.defaultView!.parent.location.origin);
    endpoint.searchParams.set('source', source);
    const response = await fetch(endpoint.href, { credentials: 'same-origin', signal });
    if (!response.ok) throw new Error(EXPORT_ERROR);
    const blob = await response.blob();
    if (!/^image\//i.test(blob.type)) throw new Error(EXPORT_ERROR);
    const data = await blobDataUrl(blob, doc);
    const decoded = new doc.defaultView!.Image();
    decoded.src = data;
    await decoded.decode();
    return data;
  } finally { canvas.width = canvas.height = 1; }
}

/** Export the measured, prepared sheet itself, rather than a second facts/layout implementation. */
export async function createVehicleSheetPdf(doc: Document, signal?: AbortSignal): Promise<Blob> {
  if (signal?.aborted) throw aborted();
  const page = readyPage(doc), controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let rejectCancelled: (() => void) | undefined;
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancelled = () => reject(signal?.aborted ? aborted() : new Error(EXPORT_ERROR));
    controller.signal.addEventListener('abort', rejectCancelled, { once: true });
    timeout = setTimeout(cancel, EXPORT_TIMEOUT_MS);
  });
  const check = () => {
    if (controller.signal.aborted) throw signal?.aborted ? aborted() : new Error(EXPORT_ERROR);
    if (readyPage(doc) !== page) throw new Error(EXPORT_ERROR);
  };
  const render = async () => {
    // These libraries stay outside the main customer route bundle.
    const [html2canvas, { jsPDF }] = await Promise.all([sheetRasterizer(doc, controller.signal), import('jspdf')]);
    check();
    await doc.fonts.ready;
    const images = await Promise.all(Array.from(page.querySelectorAll('img')).map(image => imageSnapshot(image, doc, controller.signal)));
    check();
    const bounds = page.getBoundingClientRect();
    const canvas = await html2canvas(page, {
      backgroundColor: '#ffffff', scale: EXPORT_SCALE, width: bounds.width, height: bounds.height,
      windowWidth: Math.ceil(A4.width * PIXELS_PER_MM), windowHeight: Math.ceil(A4.height * PIXELS_PER_MM),
      scrollX: 0, scrollY: 0, allowTaint: false, useCORS: true, imageTimeout: 15_000, logging: false, removeContainer: true,
      async onclone(clone) {
        const clonedPage = clone.querySelector<HTMLElement>('.lvs-page');
        if (!clonedPage) throw new Error(EXPORT_ERROR);
        const clonedImages = clonedPage.querySelectorAll('img');
        if (clonedImages.length !== images.length) throw new Error(EXPORT_ERROR);
        clonedImages.forEach((image, index) => {
          image.removeAttribute('srcset'); image.removeAttribute('crossorigin'); image.src = images[index];
        });
        // The clone has a distinct FontFaceSet. Ready on the original document
        // alone does not guarantee these fonts exist in its drawing context.
        await loadFonts(clone, !!clonedPage.querySelector('.lvs-plate'));
        // Setting a new data URL starts another decode in the clone. WebKit
        // can otherwise draw a white photo even though the source was ready.
        await Promise.all(Array.from(clonedImages).map(async image => {
          await image.decode();
          if (!image.complete || !image.naturalWidth || !image.naturalHeight) throw new Error(EXPORT_ERROR);
        }));
      },
    });
    try {
      check();
      if (Math.abs(canvas.width - bounds.width * EXPORT_SCALE) > 2 || Math.abs(canvas.height - bounds.height * EXPORT_SCALE) > 2) throw new Error(EXPORT_ERROR);
      // html2canvas does not implement CSS image filters. Match the prepared
      // monochrome sheet explicitly, including its photographs.
      if (page.classList.contains('lvs-mono')) {
        const context = canvas.getContext('2d');
        if (!context) throw new Error(EXPORT_ERROR);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < pixels.data.length; i += 4) {
          const gray = Math.round(.2126 * pixels.data[i] + .7152 * pixels.data[i + 1] + .0722 * pixels.data[i + 2]);
          pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
        }
        context.putImageData(pixels, 0, 0);
      }
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      pdf.setProperties({ title: 'Vehicle details', subject: 'Printable one-page vehicle sheet', creator: 'Luxxy DealerOS' });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, A4.width, A4.height, undefined, 'FAST');
      // Keep the canonical vehicle URL clickable as well as scannable.
      for (const anchor of page.querySelectorAll<HTMLAnchorElement>('a[href]')) {
        if (!/^(https?:|mailto:|tel:)/i.test(anchor.href)) continue;
        const rect = anchor.getBoundingClientRect();
        const x = (rect.left - bounds.left) / PIXELS_PER_MM, y = (rect.top - bounds.top) / PIXELS_PER_MM;
        const width = rect.width / PIXELS_PER_MM, height = rect.height / PIXELS_PER_MM;
        if (width > 0 && height > 0 && x >= 0 && y >= 0 && x + width <= A4.width + .1 && y + height <= A4.height + .1)
          pdf.link(x, y, width, height, { url: anchor.href });
      }
      check();
      return pdf.output('blob');
    } finally { canvas.width = canvas.height = 1; }
  };
  try { return await Promise.race([render(), cancellation]); }
  catch (error) {
    if (signal?.aborted) throw aborted();
    if (error instanceof Error && /^(The vehicle sheet is not ready|The vehicle sheet does not fit)/.test(error.message)) throw error;
    throw new Error(EXPORT_ERROR);
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
    if (rejectCancelled) controller.signal.removeEventListener('abort', rejectCancelled);
    controller.abort();
  }
}

export async function saveVehicleSheetPdf(doc: Document, filename: string, signal?: AbortSignal): Promise<void> {
  const blob = await createVehicleSheetPdf(doc, signal);
  if (signal?.aborted) throw aborted();
  readyPage(doc);
  const downloadDocument = doc.defaultView!.parent.document;
  const urls = downloadDocument.defaultView!.URL;
  const anchor = downloadDocument.createElement('a');
  let url: string | undefined;
  try {
    url = urls.createObjectURL(blob);
    anchor.href = url; anchor.download = vehicleSheetPdfFilename(filename); anchor.style.display = 'none';
    downloadDocument.body.appendChild(anchor); anchor.click();
  } catch { if (url) urls.revokeObjectURL(url); throw new Error(EXPORT_ERROR); }
  finally { anchor.remove(); }
  // Safari may read the blob after the click handler returns.
  setTimeout(() => urls.revokeObjectURL(url!), 60_000);
}
