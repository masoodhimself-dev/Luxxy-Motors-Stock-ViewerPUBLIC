import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { SalesPracticeWorkspace } from './sales-practice-workspace';

const pdf = vi.hoisted(() => ({ render: vi.fn((_document: any) => new Uint8Array([37, 80, 68, 70, 45])) }));
vi.mock('@workspace/vehicle-meta/sale-document-pdf', () => ({ saleDocumentPdfBytes: pdf.render }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));
const car = { id: 'car-one', title: 'Ford Focus', make: 'Ford', model: 'Focus', registration: '2018 (18 reg)', plate: 'AB18XYZ', year: 2018, price: 8000, inventoryStatus: 'available', images: [], heroImage: null } as unknown as Car;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); pdf.render.mockClear(); });
function startSale() {
  render(<SalesPracticeWorkspace cars={[car]} dealer={dealerConfig} onExit={() => {}} quickActions={<button>Unsafe live shortcut</button>}/>);
  fireEvent.click(screen.getByRole('button', { name: /Choose Ford Focus/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Customer details' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Choose what to do' }).find(button => !button.hasAttribute('disabled'))!);
}
function requestDeposit(amount = '500') {
  fireEvent.click(screen.getByRole('button', { name: /Request a deposit/ }));
  fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: amount } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare request' }));
}
function openDepositConfirmation(amount?: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Record the deposit' }));
  if (amount) fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: amount } });
  fireEvent.click(screen.getByLabelText('I have checked that the money has been received.'));
  fireEvent.click(screen.getByRole('button', { name: 'Record deposit' }));
  return screen.getByRole('dialog');
}
it('records a linked deposit only after explicit reservation confirmation without live calls', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  startSale(); requestDeposit();
  expect(screen.queryByRole('button', { name: 'Unsafe live shortcut' })).not.toBeInTheDocument();
  expect(screen.getByText('Deposit request prepared. No message was sent.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Create.*link/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /WhatsApp/i })).not.toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Money summary' })).toHaveTextContent('Paid£0.00');
  const dialog = openDepositConfirmation();
  expect(dialog).toHaveTextContent('This will reserve the vehicle and remove it from available stock.');
  expect(screen.queryByText('Reserved')).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm £500.00 & reserve car' }));
  await waitFor(() => expect(screen.getByText('Reserved')).toBeInTheDocument());
  expect(screen.getByText('£500.00 deposit recorded. Car reserved. £7,500.00 left to pay.')).toBeInTheDocument();
  expect(car.inventoryStatus).toBe('available');
  expect(fetch).not.toHaveBeenCalled(); expect(pdf.render).not.toHaveBeenCalled();
});
it('requires acceptance of a smaller deposit and keeps the full sale balance', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  startSale(); requestDeposit();
  const dialog = openDepositConfirmation('400');
  expect(dialog).toHaveTextContent('£100.00 less than requested');
  const confirm = within(dialog).getByRole('button', { name: 'Confirm £400.00 & reserve car' });
  expect(confirm).toBeDisabled();
  fireEvent.click(within(dialog).getByLabelText('Accept £400.00 as the deposit'));
  fireEvent.click(confirm);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('£400.00 deposit recorded. Car reserved. £7,600.00 left to pay.')).toBeInTheDocument();
  const summary = screen.getByRole('complementary', { name: 'Money summary' });
  expect(summary).toHaveTextContent('Sale total£8,000.00'); expect(summary).toHaveTextContent('Paid£400.00'); expect(summary).toHaveTextContent('Left to pay£7,600.00');
  expect(summary).not.toHaveTextContent('Not yet recorded as paid.');
  expect(fetch).not.toHaveBeenCalled();
});
it('going back from confirmation leaves the car and balance unchanged', () => {
  startSale(); requestDeposit();
  fireEvent.click(within(openDepositConfirmation()).getByRole('button', { name: 'Go back' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByText('Reserved')).not.toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Money summary' })).toHaveTextContent('Paid£0.00');
  expect(screen.getByRole('complementary', { name: 'Money summary' })).toHaveTextContent('Left to pay£8,000.00');
});
it('shows a money summary on phones without an automatic document preview', () => {
  const original = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  startSale();
  expect(screen.getByRole('complementary', { name: 'Money summary' })).toHaveTextContent('Left to pay£8,000.00');
  expect(screen.queryByRole('region', { name: 'Live document preview' })).not.toBeInTheDocument();
  expect(screen.queryByText('Preview PDF')).not.toBeInTheDocument(); expect(pdf.render).not.toHaveBeenCalled();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
});
it('renders a saved test PDF only on download and reuses the same bytes', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL() { return 'blob:test-document'; } static revokeObjectURL() {} });
  startSale(); requestDeposit();
  expect(pdf.render).not.toHaveBeenCalled();
  const saved = screen.getByRole('region', { name: 'Saved document' });
  fireEvent.click(within(saved).getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(pdf.render).toHaveBeenCalledTimes(1));
  expect(pdf.render.mock.calls[0][0].number).toContain('TEST ONLY');
  expect(pdf.render.mock.calls[0][0].snapshot.branding.invoiceSettings.footer).toContain('TEST ONLY');
  await waitFor(() => expect(within(saved).getByRole('button', { name: 'Download PDF' })).toBeEnabled());
  fireEvent.click(within(saved).getByRole('button', { name: 'Download PDF' }));
  expect(pdf.render).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
});
it('includes delivery once in the breakdown and updates the amount left to pay', () => {
  startSale();
  fireEvent.click(screen.getByRole('button', { name: /Arrange collection or delivery/ }));
  fireEvent.change(screen.getByLabelText('How will the customer receive the car?'), { target: { value: 'delivery' } });
  fireEvent.change(screen.getByLabelText('Delivery address'), { target: { value: '5 Delivery Road, London, SW1A 1AA' } });
  fireEvent.change(screen.getByLabelText('Delivery charge (£)'), { target: { value: '150' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save arrangements' }));
  const summary = screen.getByRole('complementary', { name: 'Money summary' });
  expect(summary).toHaveTextContent('Delivery£150.00'); expect(summary).toHaveTextContent('Sale total£8,150.00'); expect(summary).toHaveTextContent('Left to pay£8,150.00');
  expect(summary).not.toHaveTextContent('Other charges / credit');
});
