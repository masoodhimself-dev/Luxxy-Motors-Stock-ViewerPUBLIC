import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { enquiryDraftKey, readEnquiryDraft, saveEnquiryDraft } from '@/lib/enquiry-draft';
import { EnquiryCarPicker } from './enquiry-car-picker';

const ford = { id: 'ford', title: 'Ford Focus', make: 'Ford', model: 'Focus', colour: 'Blue', registration: 'AB12 CDE', images: [], price: 4990, inventoryStatus: 'available' } as unknown as Car;
const toyota = { ...ford, id: 'toyota', title: 'Toyota Yaris', make: 'Toyota', model: 'Yaris', registration: 'EF34 GHI', colour: 'Silver' };
beforeEach(() => window.sessionStorage.clear());

it('searches actual stock and keeps the current form when choosing a different car', () => {
  const select = vi.fn();
  render(<EnquiryCarPicker open onOpenChange={vi.fn()} cars={[ford, toyota, { ...ford, id: 'sold', title: 'Sold car', inventoryStatus: 'sold' }]} currentId={ford.id} onSelect={select} />);
  expect(screen.queryByRole('button', { name: /Choose Sold car/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search available cars' }), { target: { value: 'Silver Toyota' } });
  expect(screen.queryByRole('button', { name: /Choose Ford/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Choose Toyota Yaris/ }));
  expect(select).toHaveBeenCalledWith(toyota, true);
});

it('offers the existing enquiry before switching, preserving both cars’ drafts', () => {
  const draft = { customerName: 'Example Buyer', email: 'buyer@example.test', phone: '', message: 'My earlier question', preferredContact: 'email' as const, hasPartExchange: false, exchange: { registration: '', mileage: '', notes: '' } };
  saveEnquiryDraft(enquiryDraftKey(toyota.id, 'general'), draft);
  const select = vi.fn();
  render(<EnquiryCarPicker open onOpenChange={vi.fn()} cars={[ford, toyota]} currentId={ford.id} onSelect={select} />);
  fireEvent.click(screen.getByRole('button', { name: /Choose Toyota Yaris/ }));
  expect(select).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'You have an enquiry for this car' })).toBeVisible();
  expect(screen.getByText('My earlier question')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Open saved enquiry' }));
  expect(select).toHaveBeenCalledWith(toyota, false);
  expect(readEnquiryDraft(enquiryDraftKey(toyota.id, 'general'))).toEqual(draft);
});

it('allows cancelling a car change without changing the enquiry', () => {
  const select = vi.fn(), close = vi.fn();
  render(<EnquiryCarPicker open onOpenChange={close} cars={[ford, toyota]} currentId={ford.id} onSelect={select} />);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledWith(false);
  expect(select).not.toHaveBeenCalled();
});
