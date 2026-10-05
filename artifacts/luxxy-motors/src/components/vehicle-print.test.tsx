import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { VehiclePrint } from './vehicle-print';

it('omits demo contact details and absent vehicle sections from the printable sheet', () => {
  const car = { id: 'sparse', title: 'Ford Focus', make: 'Ford', model: 'Focus', images: [] } as unknown as Car;
  render(<VehiclePrint car={car} dealer={{ ...dealerConfig, contact: { email: 'dealer@example.com' }, address: { street: '12 Example Road (sample address)', city: 'Harrow', postcode: 'Sample postcode' } }} features={[]} />);
  const sheet = document.querySelector('.vehicle-print-sheet')!;
  expect(sheet.textContent).toContain('Harrow');
  expect(sheet.textContent).not.toMatch(/Example Road|sample address|Sample postcode|dealer@example.com|Not supplied|Price on application|Photograph unavailable/);
  expect(sheet.querySelector('.vehicle-print-description')).toBeNull();
  expect(sheet.querySelector('.vehicle-print-features')).toBeNull();
  expect(sheet.querySelector('.vehicle-print-photos')).toBeNull();
});

it('removes failed photographs and their frames without substituting a placeholder', () => {
  const car = { id: 'photos', title: 'Ford Focus', images: [{ url: '/failed-front.jpg', caption: 'Front' }, { url: '/failed-rear.jpg', caption: 'Rear' }] } as unknown as Car;
  render(<VehiclePrint car={car} dealer={dealerConfig} features={[]} />);
  const sheet = document.querySelector('.vehicle-print-sheet')!;
  const photos = [...sheet.querySelectorAll('.vehicle-print-photo img')];
  expect(photos).toHaveLength(2);
  photos.forEach(photo => fireEvent.error(photo));
  expect(sheet.querySelector('.vehicle-print-photos')).toBeNull();
  expect(sheet.textContent).not.toContain('Photograph unavailable');
});

it('opens printing even when an unrelated website font download never finishes', async () => {
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } });
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { callback(0); return 0; });
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  try {
    const car = { id: 'local-fonts', title: 'Ford Focus', images: [] } as unknown as Car;
    render(<VehiclePrint car={car} dealer={dealerConfig} features={[]} />);
    fireEvent.click(screen.getByTestId('button-print-vehicle'));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  } finally {
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
    else Reflect.deleteProperty(document, 'fonts');
    frame.mockRestore();
    print.mockRestore();
  }
});
