import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VehicleWhatsApp } from './vehicle-whatsapp';
import type { Car } from '@/lib/stock-context';

vi.mock('@/lib/dealer-settings-context', async () => {
  const { dealerConfig } = await import('@/config/dealer');
  return { useDealerSettings: () => ({ settings: { ...dealerConfig, contact: { ...dealerConfig.contact, whatsapp: '447388831790' }, hours: [] } }) };
});

const car = { id: 'context-car', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta', year: 2018, price: 7995, currency: 'GBP', plate: 'AB18 CDE', images: [] } as unknown as Car;

it('prepares a customer-editable message with the car year, price and reference', () => {
  render(<VehicleWhatsApp car={car} />);
  fireEvent.click(screen.getByRole('button', { name: 'WhatsApp about Ford Fiesta' }));
  const message = screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement;
  expect(message.value).toContain('2018 Ford Fiesta · £7,995');
  expect(message.value).toContain('Registration: AB18 CDE');
  expect(message.value).toContain('Vehicle reference: context-car');
  const href = screen.getByRole('link', { name: 'Continue to WhatsApp' }).getAttribute('href');
  expect(decodeURIComponent(href!)).toContain('2018 Ford Fiesta · £7,995');
  fireEvent.change(message, { target: { value: 'Can I visit tomorrow?' } });
  expect(decodeURIComponent(screen.getByRole('link', { name: 'Continue to WhatsApp' }).getAttribute('href')!)).toContain('Can I visit tomorrow?');
});

it('keeps walkaround requests tied to the same car', () => {
  render(<VehicleWhatsApp car={car} walkaround />);
  fireEvent.click(screen.getByRole('button', { name: 'Request a walkaround video' }));
  expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toContain('request a walkaround video of this car');
});
