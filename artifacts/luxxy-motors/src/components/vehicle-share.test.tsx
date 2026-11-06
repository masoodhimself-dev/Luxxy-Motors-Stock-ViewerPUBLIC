import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VehicleShare } from './vehicle-share';
import type { Car } from '@/lib/stock-context';
const mock = vi.hoisted(() => ({ image: vi.fn() }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { identity: { name: 'Example Motors' } } }) }));
vi.mock('./vehicle-dialog-vehicle', () => ({ useVehicleDialogTheme: () => ({}) }));
vi.mock('./vehicle-print', () => ({ VehiclePrint: () => <button>Car details PDF</button> }));
vi.mock('@/lib/vehicle-share-image', () => ({ createVehicleShareImage: mock.image }));
vi.mock('qrcode.react', () => ({ QRCodeCanvas: ({ value }: { value: string }) => <div data-testid="qr">{value}</div> }));
const car = { id:'car-1', title:'Ford Focus', make:'Ford', model:'Focus', price:5000, priceType:'+ VAT', currency:'GBP', year:2018, mileage:20000, images:['https://photos.test/car.jpg'], sourceExtras:{publicVehicleCode:'7k2m9q4n'} } as unknown as Car;
const open = () => fireEvent.click(screen.getByRole('button', {name:'Share this vehicle'}));
const extras = () => fireEvent.click(screen.getByText('More ways to share'));
beforeEach(() => { mock.image.mockReset(); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL:vi.fn(()=>'blob:preview'), revokeObjectURL:vi.fn() })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('prepares recipient-free share messages with price qualifiers and no query secrets', () => {
  window.history.replaceState({}, '', '/cars/ford-focus-7k2m9q4n?token=private');
  render(<VehicleShare car={car}/>); open();
  expect(screen.getByRole('textbox', {name:'Link to this car'})).toHaveValue(`${location.origin}/s/7k2m9q4n`);
  expect(decodeURIComponent(screen.getByRole('link', {name:'WhatsApp'}).getAttribute('href')!)).toContain('Ford Focus · £5,000 · + VAT');
  expect(screen.getByRole('link', {name:'Email'}).getAttribute('href')).toMatch(/^mailto:\?/);
  expect(screen.getByText('+ VAT')).toBeInTheDocument();
});
it('copies the short link and offers manual selection if clipboard access fails', async () => {
  const writeText=vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  render(<VehicleShare car={car}/>); open();
  fireEvent.click(screen.getByRole('button',{name:'Copy link'}));
  await screen.findByText('Link copied'); expect(writeText).toHaveBeenCalledWith(`${location.origin}/s/7k2m9q4n`);
  writeText.mockRejectedValue(new Error('Denied'));
  fireEvent.click(screen.getByRole('button',{name:'Copy link'}));
  await screen.findByText('Select and copy the link below.');
  expect(screen.getByRole('textbox',{name:'Link to this car'})).toHaveFocus();
});
it('shows a QR for the same car without using a lookup', () => {
  render(<VehicleShare car={car}/>); open(); extras(); fireEvent.click(screen.getByRole('button',{name:/Show QR code/}));
  expect(screen.getByTestId('qr')).toHaveTextContent(`${location.origin}/s/7k2m9q4n`); expect(mock.image).not.toHaveBeenCalled();
});
it('invalidates a prepared image when the current price changes', async () => {
  mock.image.mockResolvedValue(new Blob(['photo'], {type:'image/png'}));
  const view=render(<VehicleShare car={car}/>); open(); extras(); fireEvent.click(screen.getByRole('button',{name:/Create a share image/}));
  fireEvent.click(screen.getByRole('button',{name:'Preview image'})); await screen.findByRole('button',{name:'Save image'});
  view.rerender(<VehicleShare car={{...car, price:4500}}/>);
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Save image'})).not.toBeInTheDocument());
  expect(screen.getByRole('button',{name:'Preview image'})).toBeEnabled();
});
it('cancels preparation on close without showing a false timeout when reopened', async () => {
  let reject!: (error:Error)=>void;
  mock.image.mockImplementation(()=>new Promise((_resolve, fail)=>{reject=fail;}));
  render(<VehicleShare car={car}/>); open(); extras(); fireEvent.click(screen.getByRole('button',{name:/Create a share image/}));
  fireEvent.click(screen.getByRole('button',{name:'Preview image'})); await waitFor(()=>expect(mock.image).toHaveBeenCalledOnce());
  const signal=mock.image.mock.calls[0][4] as AbortSignal;
  fireEvent.click(screen.getByRole('button',{name:'Close'})); expect(signal.aborted).toBe(true);
  open(); await act(async()=>reject(new DOMException('Cancelled','AbortError')));
  expect(screen.queryByText(/took too long/)).not.toBeInTheDocument();
});
