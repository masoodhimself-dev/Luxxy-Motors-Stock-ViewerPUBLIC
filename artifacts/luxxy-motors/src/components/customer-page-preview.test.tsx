import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { previewSettings } from '../../preview/settings';
import CustomerPagePreview from './customer-page-preview';

const fixtures = vi.hoisted(() => ({
  stock: { schemaVersion: 1, count: 2, cars: [{ id: 'one', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta', plate: 'AB12 CDE' }, { id: 'two', title: 'Ford Focus', make: 'Ford', model: 'Focus' }], dealerName: 'Current cars', dealerLocation: 'London', scrapedAt: null },
  features: { features: { testDriveBookings: true, publicEnquiries: true, partExchange: false }, evaluatedAt: '2026-10-25T12:00:00Z' },
  error: null as null | string,
  render: vi.fn(({ settings, page, viewportWidth, vehicleId }) => `<h1>${settings.hero.copy}</h1><p>${page} ${viewportWidth} ${vehicleId}</p><a href="/send">A link</a><button>Send</button>`),
}));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: fixtures.stock, isLoading: false, error: fixtures.error }) }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ data: fixtures.features, isLoading: false, isError: false }) }));
vi.mock('./customer-page-preview-renderer', async importOriginal => ({ ...await importOriginal<typeof import('./customer-page-preview-renderer')>(), renderCustomerPagePreview: fixtures.render }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); fixtures.error = null; });

it('switches actual page, selected car and viewport inside a sandbox without publication or submissions', async () => {
  const onClose = vi.fn();
  const fetch = vi.spyOn(globalThis, 'fetch');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  render(<CustomerPagePreview settings={previewSettings} onClose={onClose} />);
  let frame = await screen.findByTitle('Phone home unpublished preview');
  expect(frame).toHaveAttribute('sandbox', '');
  expect(frame).toHaveAttribute('width', '390');
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(frame.getAttribute('srcdoc')).toContain(previewSettings.hero.copy);
  expect(frame.getAttribute('srcdoc')).not.toContain('href="/send"');
  fireEvent.click(screen.getByRole('button', { name: 'iPad' }));
  frame = await screen.findByTitle('iPad home unpublished preview');
  expect(frame).toHaveAttribute('width', '820');
  fireEvent.change(screen.getByRole('combobox', { name: 'Preview page' }), { target: { value: 'vehicle' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Preview vehicle' }), { target: { value: 'two' } });
  await waitFor(() => expect(fixtures.render).toHaveBeenLastCalledWith(expect.objectContaining({ page: 'vehicle', vehicleId: 'two', viewportWidth: 820, stock: fixtures.stock, features: fixtures.features })));
  fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
  expect(await screen.findByTitle('Desktop vehicle unpublished preview')).toHaveAttribute('width', '1440');
  expect(fetch).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledOnce();
});

it('shows a truthful error instead of sample stock when current data is unavailable', () => {
  fixtures.error = 'Stock unavailable';
  render(<CustomerPagePreview settings={previewSettings} onClose={() => {}} />);
  expect(screen.getByRole('alert')).toHaveTextContent('no example cars or guessed access settings');
  expect(screen.queryByTitle(/unpublished preview/)).not.toBeInTheDocument();
  expect(fixtures.render).not.toHaveBeenCalled();
});


it('never mounts a new page, size or car with markup from the previous selection', async () => {
  let expected = 'home 390 one';
  const assignments: Array<{ expected: string; html: string }> = [];
  const original = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name, value) {
    if (this.tagName === 'IFRAME' && name.toLowerCase() === 'srcdoc') assignments.push({ expected, html: String(value) });
    return original.call(this, name, value);
  });
  render(<CustomerPagePreview settings={previewSettings} onClose={() => {}} />);
  await screen.findByTitle('Phone home unpublished preview');
  for (const [label, width] of [['Phone', 390], ['iPad', 820], ['Desktop', 1440]] as const) {
    const previousPage = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Preview page' }).value;
    expected = `${previousPage} ${width} one`;
    fireEvent.click(screen.getByRole('button', { name: label }));
    for (const page of ['stock', 'vehicle', 'contact', 'warranty', 'home']) {
      expected = `${page} ${width} one`;
      fireEvent.change(screen.getByRole('combobox', { name: 'Preview page' }), { target: { value: page } });
      await screen.findByTitle(`${label} ${page} unpublished preview`);
    }
  }
  expected = 'vehicle 1440 one';
  fireEvent.change(screen.getByRole('combobox', { name: 'Preview page' }), { target: { value: 'vehicle' } });
  expected = 'vehicle 1440 two';
  fireEvent.change(screen.getByRole('combobox', { name: 'Preview vehicle' }), { target: { value: 'two' } });
  await waitFor(() => expect(assignments.at(-1)?.html).toContain('<p>vehicle 1440 two</p>'));
  expect(assignments.length).toBeGreaterThanOrEqual(19);
  for (const assignment of assignments) expect(assignment.html).toContain(`<p>${assignment.expected}</p>`);
});


it('measures the stage after the dialog portal mounts and follows later container resizes', async () => {
  let stageWidth = 1376;
  let resize = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('customer-page-preview-stage') ? stageWidth : 0;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe = observe;
    disconnect = disconnect;
  });
  const { unmount } = render(<CustomerPagePreview settings={previewSettings} onClose={() => {}} />);
  await screen.findByTitle('Phone home unpublished preview');
  await waitFor(() => expect(observe).toHaveBeenCalledWith(document.querySelector('.customer-page-preview-stage')));
  fireEvent.click(screen.getByRole('button', { name: 'Desktop' }));
  const frame = await screen.findByTitle('Desktop home unpublished preview');
  expect(frame.style.transform).toBe(`scale(${1376 / 1440})`);
  expect(screen.getByText(/scaled to 96% to fit this screen/)).toBeInTheDocument();
  stageWidth = 900;
  act(() => resize());
  expect(frame.style.transform).toBe(`scale(${900 / 1440})`);
  expect(screen.getByText(/scaled to 63% to fit this screen/)).toBeInTheDocument();
  unmount();
  expect(disconnect).toHaveBeenCalled();
});


it('explains when a stock refresh removes the last previewable car without changing page', async () => {
  const currentCars = fixtures.stock.cars;
  const currentCount = fixtures.stock.count;
  const onClose = () => {};
  const { rerender } = render(<CustomerPagePreview settings={previewSettings} onClose={onClose} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Preview page' }), { target: { value: 'vehicle' } });
  await screen.findByTitle('Phone vehicle unpublished preview');
  try {
    fixtures.stock.cars = [];
    fixtures.stock.count = 0;
    rerender(<CustomerPagePreview settings={previewSettings} onClose={onClose} />);
    expect(screen.getByRole('status')).toHaveTextContent('No current vehicle is available to preview. Choose another page.');
    expect(screen.getByRole('combobox', { name: 'Preview page' })).toHaveValue('vehicle');
    expect(screen.queryByTitle(/unpublished preview/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Preview page' }), { target: { value: 'contact' } });
    expect(await screen.findByTitle('Phone contact unpublished preview')).toBeInTheDocument();
  } finally {
    fixtures.stock.cars = currentCars;
    fixtures.stock.count = currentCount;
  }
});
