import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { VehiclePrint } from './vehicle-print';
const prepare = vi.hoisted(() => vi.fn());
vi.mock('@/lib/vehicle-sheet/controller', () => ({ prepareVehicleSheet: prepare }));
const car = { id: 'actual-car', title: 'Ford Focus', make: 'Ford', model: 'Focus', images: [] } as unknown as Car;
const features: string[] = [];
afterEach(() => { cleanup(); vi.restoreAllMocks(); prepare.mockReset(); document.querySelector('meta[name="luxxy-canonical-origin"]')?.remove(); });
function setup() {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const meta = document.createElement('meta'); meta.name = 'luxxy-canonical-origin'; meta.content = 'https://luxxymotors.uk'; meta.setAttribute('data-page-meta', ''); document.head.appendChild(meta);
}
it('prepares only inside an isolated A4 iframe with the canonical vehicle URL', async () => {
  setup(); prepare.mockResolvedValue({ status: 'ready' });
  render(<VehiclePrint car={car} dealer={dealerConfig} features={features} />);
  fireEvent.click(screen.getByTestId('button-print-vehicle'));
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  const [host, data, options] = prepare.mock.calls[0];
  expect(host.ownerDocument).not.toBe(document);
  expect(data.document.vehiclePageUrl).toBe('https://luxxymotors.uk/vehicle/actual-car');
  expect(options.dealerWebsiteOrigin).toBe('https://luxxymotors.uk');
  expect(document.querySelector('style[data-luxxy-vehicle-sheet]')).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', {name:'Print A4 sheet'})).toBeEnabled());
});
it('cancels a pending old vehicle render and removes its document when closed', async () => {
  setup(); prepare.mockImplementation(() => new Promise(() => {}));
  render(<VehiclePrint car={car} dealer={dealerConfig} features={features} />);
  fireEvent.click(screen.getByTestId('button-print-vehicle'));
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  const signal = prepare.mock.calls[0][3];
  fireEvent.click(screen.getByRole('button', {name:'Close'}));
  expect(signal.aborted).toBe(true);
  expect(document.querySelector('iframe')).toBeNull();
});
it('does not enable printing when the QR destination or assets fail validation', async () => {
  setup(); prepare.mockResolvedValue({ status: 'invalid-url', message: 'Use a public HTTPS dealership website URL.' });
  render(<VehiclePrint car={car} dealer={dealerConfig} features={features} />);
  fireEvent.click(screen.getByTestId('button-print-vehicle'));
  expect(await screen.findByRole('alert')).toHaveTextContent('public HTTPS');
  expect(screen.getByRole('button', {name:'Print A4 sheet'})).toBeDisabled();
});
