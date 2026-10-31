import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { VehiclePrint } from './vehicle-print';

const state = vi.hoisted(() => ({ prepare: vi.fn(), api: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/vehicle-sheet/controller', () => ({ prepareVehicleSheet: state.prepare }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.api(...args) }));
vi.mock('@/lib/vehicle-sheet/pdf', () => ({
  saveVehicleSheetPdf: (...args: unknown[]) => state.save(...args),
  vehicleSheetPdfFilename: (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf',
}));

const id = '00000000-0000-4000-8000-000000000123';
const oldCar = { id, title: 'Ford Focus', make: 'Ford', model: 'Focus', price: 9000, images: [], description: 'Old description', features: ['Old equipment'] } as unknown as Car;
const checkedCar = { ...oldCar, price: 7500, description: 'Fresh car description from the checked advert.', features: ['Heated front seats'], inventoryStatus: 'available' };
const features = ['Old supplied prop equipment'];
const printButton = () => screen.getByRole('button', { name: 'Print A4 sheet' });
const downloadButton = () => screen.getByRole('button', { name: 'Download PDF' });
const open = () => fireEvent.click(screen.getByTestId('button-print-vehicle'));
async function openReady() { open(); await waitFor(() => expect(printButton()).toBeEnabled()); }

beforeEach(() => {
  state.prepare.mockReset(); state.prepare.mockResolvedValue({ status: 'ready' });
  state.api.mockReset(); state.api.mockResolvedValue(structuredClone(checkedCar));
  state.save.mockReset(); state.save.mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const meta = document.createElement('meta'); meta.name = 'luxxy-canonical-origin'; meta.content = 'https://luxxymotors.uk'; meta.setAttribute('data-page-meta', ''); document.head.appendChild(meta);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove(); });

it('checks the current car before preparing an isolated A4 iframe with its canonical vehicle URL', async () => {
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  await openReady();
  expect(state.api).toHaveBeenCalledOnce();
  expect(state.api).toHaveBeenCalledWith(`/api/vehicles/${id}`, expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store' }));
  expect(state.prepare).toHaveBeenCalledOnce();
  const [host, data, options] = state.prepare.mock.calls[0];
  expect(host.ownerDocument).not.toBe(document);
  expect(data.document.vehiclePageUrl).toBe(`https://luxxymotors.uk/vehicle/${id}`);
  expect(options).toMatchObject({ dealerWebsiteOrigin: 'https://luxxymotors.uk', monochrome: false });
  expect(data.vehicle.price).toContain('7,500');
  expect(document.querySelector('style[data-luxxy-vehicle-sheet]')).toBeNull();
  expect(downloadButton()).toBeEnabled();
});

it('uses fresh description and equipment instead of old car and supplied prop content', async () => {
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} description="Old supplied prop description" />);
  await openReady();
  const data = state.prepare.mock.calls[0][1];
  expect(JSON.stringify(data)).toContain('Fresh car description from the checked advert.');
  expect(JSON.stringify(data)).toContain('Heated front seats');
  expect(JSON.stringify(data)).not.toMatch(/Old description|Old equipment|Old supplied prop/);
});

it.each([
  ['not found', () => Promise.reject({ status: 404 }), /no longer available/],
  ['sold', () => Promise.resolve({ ...checkedCar, inventoryStatus: 'sold' }), /no longer available/],
  ['missing from feed', () => Promise.resolve({ ...checkedCar, sourceExtras: { websiteSourceStatus: 'missing' } }), /no longer available/],
  ['unrelated car', () => Promise.resolve({ ...checkedCar, id: 'different-car' }), /couldn’t check/],
  ['invalid price', () => Promise.resolve({ ...checkedCar, price: '7500' }), /couldn’t check/],
  ['malformed response', () => Promise.resolve({ id }), /couldn’t check/],
] as const)('blocks %s without preparing a stale fallback', async (_name, reply, message) => {
  state.api.mockImplementation(reply);
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(printButton()).toBeDisabled(); expect(downloadButton()).toBeDisabled();
  expect(state.prepare).not.toHaveBeenCalled(); expect(document.querySelector('iframe')).toBeNull();
});

it('rechecks a failed freshness request when staff or a customer choose Try again', async () => {
  state.api.mockRejectedValueOnce(new Error('Temporary connection failure')).mockResolvedValueOnce(structuredClone(checkedCar));
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  open(); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(state.api).toHaveBeenCalledTimes(2); expect(state.prepare).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('checks once per opening and ink-saving rebuilds the prepared sheet without another source request', async () => {
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  await openReady();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Ink-saving' }));
  await waitFor(() => expect(state.prepare).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(state.prepare.mock.calls[1][2].monochrome).toBe(true); expect(state.api).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await openReady();
  expect(state.api).toHaveBeenCalledTimes(2); expect(state.prepare).toHaveBeenCalledTimes(3);
});

it('uses optional MOT cache reads only and prepares a current sheet when that cache is unavailable', async () => {
  state.api.mockImplementation(async (url: string) => {
    if (url.endsWith('/mot-history?cacheOnly=true')) throw new Error('Optional cache is unavailable');
    return { ...checkedCar, registration: 'AB12 XYZ' };
  });
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  await openReady();
  expect(state.api).toHaveBeenCalledTimes(2);
  expect(state.api).toHaveBeenNthCalledWith(2, `/api/vehicles/${id}/mot-history?cacheOnly=true`, expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store' }));
  expect(screen.queryByRole('alert')).toBeNull(); expect(state.prepare).toHaveBeenCalledOnce();
});

it('ignores a malformed available MOT cache record without blocking the freshly checked car', async () => {
  state.api.mockImplementation(async (url: string) => url.endsWith('/mot-history?cacheOnly=true')
    ? { status: 'available', history: {} }
    : { ...checkedCar, registration: 'AB12 XYZ' });
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  await openReady();
  expect(state.api).toHaveBeenCalledTimes(2); expect(state.prepare).toHaveBeenCalledOnce();
  expect(state.prepare.mock.calls[0][1].vehicle.price).toContain('7,500');
  expect(state.prepare.mock.calls[0][1].vehicle.motSummary).toBeUndefined();
  expect(screen.queryByRole('alert')).toBeNull(); expect(downloadButton()).toBeEnabled();
});

it('bounds a slow optional MOT cache request without blocking the already-checked car', async () => {
  state.api.mockImplementation((url: string, options: { signal: AbortSignal }) => {
    if (url.endsWith('/mot-history?cacheOnly=true')) return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cache request timed out', 'AbortError')), { once: true }));
    return Promise.resolve({ ...checkedCar, registration: 'AB12 XYZ' });
  });
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  open(); await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
  const motSignal = state.api.mock.calls[1][1].signal as AbortSignal;
  await waitFor(() => expect(printButton()).toBeEnabled(), { timeout: 3500 });
  expect(motSignal.aborted).toBe(true); expect(screen.queryByRole('alert')).toBeNull(); expect(state.prepare).toHaveBeenCalledOnce();
});

it('discards a late previous-car response after the vehicle ID changes', async () => {
  const nextId = '00000000-0000-4000-8000-000000000456';
  let resolveOld: (value: Car) => void = () => {};
  state.api.mockImplementationOnce(() => new Promise<Car>(resolve => { resolveOld = resolve; })).mockResolvedValueOnce({ ...checkedCar, id: nextId, price: 8100 });
  const view = render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  open(); await waitFor(() => expect(state.api).toHaveBeenCalledOnce());
  const previousSignal = state.api.mock.calls[0][1].signal as AbortSignal;
  view.rerender(<VehiclePrint car={{ ...oldCar, id: nextId }} dealer={dealerConfig} features={features} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(previousSignal.aborted).toBe(true);
  resolveOld(structuredClone(checkedCar));
  await waitFor(() => expect(state.prepare).toHaveBeenCalledOnce());
  expect(state.prepare.mock.calls[0][1].document.vehiclePageUrl).toBe(`https://luxxymotors.uk/vehicle/${nextId}`);
  expect(state.prepare.mock.calls[0][1].vehicle.price).toContain('8,100');
});

it('aborts the source check on close and only a newly checked car is used on reopening', async () => {
  state.api.mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(structuredClone(checkedCar));
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  open(); await waitFor(() => expect(state.api).toHaveBeenCalledOnce());
  const sourceSignal = state.api.mock.calls[0][1].signal as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(sourceSignal.aborted).toBe(true); expect(state.prepare).not.toHaveBeenCalled();
  await openReady();
  expect(state.api).toHaveBeenCalledTimes(2); expect(state.prepare).toHaveBeenCalledOnce();
});

it('cancels a pending old sheet render and removes its document on close', async () => {
  state.prepare.mockImplementation(() => new Promise(() => {}));
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  open(); await waitFor(() => expect(state.prepare).toHaveBeenCalledOnce());
  const signal = state.prepare.mock.calls[0][3] as AbortSignal;
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(signal.aborted).toBe(true); expect(document.querySelector('iframe')).toBeNull();
});

it('blocks both actions if the QR destination, assets or required A4 content fail preparation', async () => {
  state.prepare.mockResolvedValue({ status: 'invalid-url', message: 'Internal source detail must not be displayed.' });
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  open();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not fit safely on one A4 page');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Internal source detail');
  expect(printButton()).toBeDisabled(); expect(downloadButton()).toBeDisabled();
});

it('keeps printing available after a failed PDF download and permits a download retry', async () => {
  state.save.mockRejectedValueOnce(new Error('Canvas rejected')).mockResolvedValueOnce(undefined);
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  await openReady(); fireEvent.click(downloadButton());
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF could not be downloaded');
  expect(printButton()).toBeEnabled(); expect(downloadButton()).toBeEnabled();
  fireEvent.click(downloadButton());
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(downloadButton()).toBeEnabled());
  expect(screen.queryByRole('alert')).toBeNull(); expect(state.api).toHaveBeenCalledOnce();
});

it('aborts an in-flight PDF on close and reopening does not leave either action disabled', async () => {
  state.save.mockImplementationOnce((_doc: Document, _filename: string, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })));
  render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  await openReady(); fireEvent.click(downloadButton());
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const signal = state.save.mock.calls[0][2] as AbortSignal;
  expect(printButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(signal.aborted).toBe(true);
  await openReady();
  expect(downloadButton()).toBeEnabled(); expect(screen.queryByRole('alert')).toBeNull();
});

it('aborts an old-car PDF when the current vehicle changes while the dialog remains open', async () => {
  const nextId = '00000000-0000-4000-8000-000000000456';
  state.save.mockImplementationOnce((_doc: Document, _filename: string, signal: AbortSignal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })));
  const view = render(<VehiclePrint car={oldCar} dealer={dealerConfig} features={features} />);
  await openReady(); fireEvent.click(downloadButton());
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  const previousSignal = state.save.mock.calls[0][2] as AbortSignal;
  state.api.mockResolvedValueOnce({ ...checkedCar, id: nextId });
  view.rerender(<VehiclePrint car={{ ...oldCar, id: nextId }} dealer={dealerConfig} features={features} />);
  await waitFor(() => expect(previousSignal.aborted).toBe(true));
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(downloadButton()).toBeEnabled(); expect(screen.queryByRole('alert')).toBeNull();
  expect(state.prepare.mock.calls.at(-1)![1].document.vehiclePageUrl).toBe(`https://luxxymotors.uk/vehicle/${nextId}`);
});
