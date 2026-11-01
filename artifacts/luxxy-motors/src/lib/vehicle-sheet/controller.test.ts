import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetOptions, VehicleSheetData } from './types';
import { SheetInputError } from './validation';

const assets = vi.hoisted(() => ({ loadAssets: vi.fn(), loadFonts: vi.fn() }));
vi.mock('./assets', () => assets);
import { prepareVehicleSheet } from './controller';

let frame: HTMLIFrameElement;
let doc: Document;
let host: HTMLElement;
const data = (url: string, name = 'Another dealership name'): VehicleSheetData => ({ dealer: { name }, vehicle: { title: 'Toyota Corolla' }, document: { vehiclePageUrl: url } });
const options = (origin: string): SheetOptions => ({ dealerWebsiteOrigin: origin, vehiclePathPrefix: '/vehicle/' });

beforeEach(() => {
  frame = document.createElement('iframe');
  document.body.appendChild(frame);
  doc = frame.contentDocument!;
  host = doc.createElement('main');
  doc.body.appendChild(host);
  assets.loadAssets.mockResolvedValue({ photos: [], warnings: [], failedAssets: [] });
  // Stop before geometry/raster work; these tests cover validated scope and the
  // font-installation boundary, with no network, DVSA or browser print request.
  assets.loadFonts.mockImplementation(async () => { throw new SheetInputError('FONT_LOAD_FAILED', 'Stopped after stylesheet inspection.'); });
});
afterEach(() => { frame.remove(); vi.clearAllMocks(); });

describe('vehicle-sheet validated branding boundary', () => {
  it('installs Montserrat after URL validation and before the existing font-loading check', async () => {
    let themedAtLoad = false;
    assets.loadFonts.mockImplementation(async (target: Document) => {
      themedAtLoad = target.querySelector('style[data-luxxy-vehicle-sheet-theme]')?.textContent?.includes('data:font/woff2;base64,') === true;
      throw new SheetInputError('FONT_LOAD_FAILED', 'Stopped after stylesheet inspection.');
    });
    const result = await prepareVehicleSheet(host, data('https://multichoicemotors.co.uk/vehicle/car-one'), options('https://multichoicemotors.co.uk'));
    expect(themedAtLoad).toBe(true);
    expect(assets.loadFonts).toHaveBeenCalledExactlyOnceWith(doc, false);
    expect(result.vehiclePageUrl).toBe('https://multichoicemotors.co.uk/vehicle/car-one');
    expect(result.status).toBe('asset-error');
  });

  it('never uses an editable dealership name to theme another valid website', async () => {
    await prepareVehicleSheet(host, data('https://shoredrive.uk/vehicle/car-one', 'Multi-Choice Motors'), options('https://shoredrive.uk'));
    expect(doc.querySelector('[data-luxxy-vehicle-sheet-theme]')).toBeNull();
    expect(assets.loadFonts).toHaveBeenCalledExactlyOnceWith(doc, false);
  });

  it.each([
    ['https://multichoicemotors.co.uk/vehicle/car-one', 'https://shoredrive.uk'],
    ['https://multichoicemotors.co.uk/portal/sales', 'https://multichoicemotors.co.uk'],
    ['https://multichoicemotors.co.uk/vehicle/car-one?token=private', 'https://multichoicemotors.co.uk'],
    ['http://multichoicemotors.co.uk/vehicle/car-one', 'http://multichoicemotors.co.uk'],
  ])('rejects an untrusted or non-public vehicle URL before activating branding/fonts: %s', async (url, origin) => {
    const result = await prepareVehicleSheet(host, data(url), options(origin));
    expect(result.status).toBe('invalid-url');
    expect(doc.querySelector('[data-luxxy-vehicle-sheet-theme]')).toBeNull();
    expect(assets.loadFonts).not.toHaveBeenCalled();
    expect(assets.loadAssets).not.toHaveBeenCalled();
  });
});
