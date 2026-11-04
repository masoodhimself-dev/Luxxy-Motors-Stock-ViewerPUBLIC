import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { SalesPracticeWorkspace } from './sales-practice-workspace';

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));

const car = { id: 'car-one', title: 'Ford Focus', make: 'Ford', model: 'Focus', registration: '2018 (18 reg)', plate: 'AB18XYZ', year: 2018, price: 8000, inventoryStatus: 'available', images: [], heroImage: null } as unknown as Car;
afterEach(() => { vi.restoreAllMocks(); });

it('prepares a request and records a deposit on copied stock without any live request or external sharing', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  render(<SalesPracticeWorkspace cars={[car]} dealer={dealerConfig} onExit={() => {}} quickActions={<button>Unsafe live shortcut</button>}/>);
  expect(screen.queryByRole('button', { name: 'Unsafe live shortcut' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Choose Ford Focus/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Customer details' }));
  expect(screen.getByRole('region', { name: 'Live document preview' })).toHaveTextContent(/AB18\s*XYZ/);
  expect(screen.getByLabelText('Full name')).toHaveValue('Alex Example');
  fireEvent.click(screen.getAllByRole('button', { name: 'Choose what to do' }).find(button => !button.hasAttribute('disabled'))!);
  fireEvent.click(screen.getByRole('button', { name: /Request a deposit/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare request' }));
  expect(await screen.findByText('Request prepared locally. No link or message was sent.')).toBeInTheDocument();
  expect(screen.getAllByRole('status').some(element => element.textContent?.includes('Deposit requested'))).toBe(true);
  expect(screen.queryByRole('button', { name: 'Email PDF' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open WhatsApp' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Other actions' }));
  fireEvent.click(screen.getByRole('button', { name: /Take a deposit/ }));
  fireEvent.click(screen.getByLabelText('I have checked that the money has been received.'));
  fireEvent.click(screen.getByRole('button', { name: 'Record deposit' }));
  await waitFor(() => expect(screen.getByText('Reserved')).toBeInTheDocument());
  expect(car.inventoryStatus).toBe('available');
  expect(fetch).not.toHaveBeenCalled();
});

it('starts with the document folded on a phone and never auto-prepares a PDF', () => {
  const original = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  const view = render(<SalesPracticeWorkspace cars={[car]} dealer={dealerConfig} onExit={() => {}}/>);
  fireEvent.click(screen.getByRole('button', { name: /Choose Ford Focus/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Customer details' }));
  expect(screen.getByText('View document').closest('details')).not.toHaveAttribute('open');
  expect(screen.queryByRole('link', { name: 'Open PDF' })).not.toBeInTheDocument();
  view.unmount();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
});
