import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VehicleWhatsApp } from './vehicle-whatsapp';
import type { Car } from '@/lib/stock-context';

vi.mock('@/lib/dealer-settings-context', async () => {
  const { dealerConfig } = await import('@/config/dealer');
  return { useDealerSettings: () => ({ settings: { ...dealerConfig, contact: { ...dealerConfig.contact, whatsapp: '447388831790' }, hours: [] } }) };
});

const car = { id: 'context-car', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta', year: 2018, price: 7995, currency: 'GBP', plate: 'AB18 CDE', images: [] } as unknown as Car;

it('prepares a customer-editable message with the car year, price and registration without an internal reference', () => {
  render(<VehicleWhatsApp car={car} />);
  fireEvent.click(screen.getByRole('button', { name: 'WhatsApp about Ford Fiesta' }));
  const message = screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement;
  expect(message.value).toContain('2018 Ford Fiesta · £7,995');
  expect(message.value).toContain('Registration: AB18 CDE');
  expect(message.value).not.toContain('Vehicle reference');
  expect(message.value).not.toContain('context-car');
  const href = screen.getByRole('link', { name: 'Continue to WhatsApp' }).getAttribute('href');
  expect(decodeURIComponent(href!)).toContain('2018 Ford Fiesta · £7,995');
  fireEvent.change(message, { target: { value: 'Can I visit tomorrow?' } });
  expect(decodeURIComponent(screen.getByRole('link', { name: 'Continue to WhatsApp' }).getAttribute('href')!)).toContain('Can I visit tomorrow?');
});

it('keeps a customer’s edited draft after dismissal and offers an explicit reset', async () => {
  render(<VehicleWhatsApp car={car} />);
  fireEvent.click(screen.getByRole('button', { name: 'WhatsApp about Ford Fiesta' }));
  const prepared = (screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value;
  fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), { target: { value: 'Could you confirm whether both keys are included?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'WhatsApp about Ford Fiesta' }));
  expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue('Could you confirm whether both keys are included?');
  fireEvent.click(screen.getByRole('button', { name: 'Reset message' }));
  expect(screen.getByRole('textbox', { name: 'Your message' })).toHaveValue(prepared);
});

it('starts a new car with its own message and closes the previous car’s sheet', () => {
  const { rerender } = render(<VehicleWhatsApp car={car} />);
  fireEvent.click(screen.getByRole('button', { name: 'WhatsApp about Ford Fiesta' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), { target: { value: 'A question about the Fiesta' } });
  rerender(<VehicleWhatsApp car={{ ...car, id: 'other-car', title: 'Volvo V90', make: 'Volvo', model: 'V90', plate: 'CD21 EFG' }} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'WhatsApp about Volvo V90' }));
  const value = (screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value;
  expect(value).toContain('Volvo V90');
  expect(value).not.toContain('Fiesta');
});
