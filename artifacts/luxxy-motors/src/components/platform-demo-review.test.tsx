import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { buildDemoReview, type DemoReview } from '@workspace/vehicle-meta';
import { PlatformDemoReview } from './platform-demo-review';

const sourceUrl = 'https://www.autotrader.co.uk/dealers/example-123';
const publicDetails = { sourceUrl, checkedAt: '2026-11-18T10:00:00Z', phone: '020 7000 1234', email: 'sales@example.test', websiteUrl: 'https://example.test', about: 'Family-run showroom.',
  showroomAddress: { sourceUrl, checkedAt: '2026-11-18T10:00:00Z', street: '12 High Street', city: 'Hayes', postcode: 'UB3 3EP' },
  openingHours: { sourceUrl, checkedAt: '2026-11-18T10:00:00Z', timezone: 'Europe/London', days: Array.from({ length: 7 }, (_, day) => ({ day, status: day === 0 ? 'closed' : 'open', ...(day ? { open: '09:00', close: '18:00' } : {}) })) },
};
export function reviewFixture(): DemoReview {
  const car = { make: 'Lexus', model: 'NX', year: 2015, price: 9500, mileage: 50000, fuel: 'Petrol', transmission: 'Automatic', registration: 'SK15NVJ', description: 'Heated seats and full service history.', heroImage: 'https://images.example.test/lexus.jpg', images: ['https://images.example.test/lexus-rear.jpg'] };
  return buildDemoReview({
    dealer: { id: 'demo-example', name: 'Example Motors', platform: 'autotrader', sourceUrl, status: 'draft', expiresAt: '2026-12-01T10:00:00Z', revision: 3, settingsRevision: 2 },
    hasSavedLogo: true, config: { identity: { logoAsset: '/api/demo-logo' }, contact: { phone: publicDetails.phone, email: publicDetails.email }, address: publicDetails.showroomAddress, hours: [{ days: 'Mon–Sat', times: '09:00–18:00' }, { days: 'Sunday', times: 'Closed' }], presentation: { visitInstructions: 'Please call before visiting.' } },
    businessDetails: { dealershipDetails: publicDetails },
    latestImport: { expectedCount: 3, scrapedAt: '2026-11-18T10:00:00Z', receivedAt: '2026-11-18T10:05:00Z' }, now: '2026-11-18T10:15:00Z',
    vehicles: [{ ...car, id: 'complete', title: 'Lexus NX' }, { ...car, id: 'no-photo', title: 'BMW X6', heroImage: null, images: [] }, { ...car, id: 'missing-details', title: 'Honda Elysion', registration: '', description: '' }],
  });
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const renderReview = (props: Partial<React.ComponentProps<typeof PlatformDemoReview>> = {}) => render(<PlatformDemoReview dealerId="demo-example" onUploadStock={() => {}} onManageDemo={() => {}} {...props}/>);

it('reviews saved dealership details and stock before offering the private preview, with missing items first', async () => {
  const result = reviewFixture();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
  renderReview();
  expect(screen.queryByRole('link', { name: /Open private preview/ })).not.toBeInTheDocument();
  const link = await screen.findByRole('link', { name: /Open private preview/ });
  expect(link).toHaveAttribute('href', result.preview.path);
  expect(screen.getByAltText('Example Motors logo')).toHaveAttribute('src', result.details.logoUrl);
  expect(screen.getByText('12 High Street')).toBeInTheDocument();
  expect(screen.getByText('sales@example.test')).toBeInTheDocument();
  expect(screen.getByText('Mon–Sat')).toBeInTheDocument();
  expect(screen.getByLabelText('Saved stock summary')).toHaveTextContent('Cars imported3Without photos1Missing key details1');
  const list = screen.getByRole('list');
  const items = within(list).getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('BMW X6');
  expect(items[1]).toHaveTextContent('Honda Elysion');
  expect(items[2]).toHaveTextContent('Lexus NX');
  expect(items[1]).toHaveTextContent('Missing: Registration, Advert description');
  expect(items[2]).toHaveTextContent('2 photo links');
  expect(screen.queryByLabelText('Showroom phone')).not.toBeInTheDocument();
});

it('filters no-photo and missing-detail cars, searches registrations, and clears an empty result', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(reviewFixture())));
  renderReview();
  await screen.findByRole('heading', { name: 'Example Motors' });
  fireEvent.click(screen.getByRole('button', { name: 'No photos 1' }));
  expect(screen.getByRole('button', { name: 'No photos 1' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByRole('listitem')).toHaveTextContent('BMW X6');
  fireEvent.click(screen.getByRole('button', { name: 'Missing details 1' }));
  expect(screen.getByRole('listitem')).toHaveTextContent('Honda Elysion');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search demo stock' }), { target: { value: 'SK15NVJ' } });
  expect(screen.getByText('No cars match this view')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show all cars' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByRole('textbox', { name: 'Search demo stock' })).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search demo stock' }), { target: { value: 'SK15NVJ' } });
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
});

it('offers a retry after a review error and keeps preview links absent until it loads', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: 'Could not read saved demo stock.' }, { status: 503 })).mockResolvedValueOnce(Response.json(reviewFixture()));
  vi.stubGlobal('fetch', fetcher);
  renderReview();
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not read saved demo stock.');
  expect(screen.queryByRole('link', { name: /Open private preview/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('link', { name: /Open private preview/ })).toBeInTheDocument();
});

it('saves confirmed corrections using the reviewed revision and shows the saved result', async () => {
  const original = reviewFixture();
  const updated = structuredClone(original);
  updated.dealer.revision = 4; updated.details.phone = '020 7999 5678';
  updated.details.editableDetails = { ...publicDetails, phone: updated.details.phone };
  const fetcher = vi.fn(async (_path, init) => Response.json(init?.method === 'PATCH' ? updated : original));
  vi.stubGlobal('fetch', fetcher);
  renderReview();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
  const phone = screen.getByRole('textbox', { name: 'Showroom phone' });
  expect(phone).toHaveFocus();
  fireEvent.change(phone, { target: { value: updated.details.phone } });
  fireEvent.click(screen.getByRole('button', { name: 'Save dealership details' }));
  expect(await screen.findByText(updated.details.phone)).toBeInTheDocument();
  expect(screen.queryByLabelText('Showroom phone')).not.toBeInTheDocument();
  const patch = fetcher.mock.calls.find(([, init]) => init?.method === 'PATCH');
  expect(patch?.[0]).toBe('/api/platform/dealers/demo-example/demo-review');
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ expectedRevision: 3, expectedSettingsRevision: 2, dealershipDetails: { sourceUrl, checkedAt: expect.any(String), phone: updated.details.phone } });
  expect(screen.getByRole('button', { name: 'Edit details' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Edit details' }));
  expect(screen.getByRole('textbox', { name: 'Showroom phone' })).toHaveValue(updated.details.phone);
  expect(screen.getByLabelText('About the dealership')).toHaveValue(publicDetails.about);
});

it('does not overwrite a newer demo and offers to reload after a concurrent edit', async () => {
  const original = reviewFixture();
  const fetcher = vi.fn(async (_path, init) => init?.method === 'PATCH' ? Response.json({ error: 'Revision changed.' }, { status: 409 }) : Response.json(original));
  vi.stubGlobal('fetch', fetcher);
  renderReview();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit details' }));
  fireEvent.change(screen.getByLabelText('Showroom phone'), { target: { value: '020 7999 0000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save dealership details' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This demo changed while you were editing.');
  expect(screen.getByLabelText('Showroom phone')).toHaveValue('020 7999 0000');
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved details' }));
  await waitFor(() => expect(screen.queryByLabelText('Showroom phone')).not.toBeInTheDocument());
  expect(screen.getByText(publicDetails.phone)).toBeInTheDocument();
});

it('keeps expired previews disabled but allows access to the saved review and demo controls', async () => {
  const result = reviewFixture();
  result.preview = { ...result.preview, allowed: false, reason: 'This demo has expired. Extend it before opening the preview.' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
  const onManageDemo = vi.fn();
  renderReview({ onManageDemo });
  expect(await screen.findByRole('button', { name: 'Open private preview' })).toBeDisabled();
  expect(screen.queryByRole('link', { name: /View car/ })).not.toBeInTheDocument();
  expect(screen.getByText('This demo has expired. Extend it before opening the preview.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Manage demo access' }));
  expect(onManageDemo).toHaveBeenCalledTimes(1);
});

it('explains empty stock and opens the upload action without inventing vehicles', async () => {
  const result = reviewFixture();
  result.stock = { ...result.stock, count: 0, noPhotosCount: 0, missingInfoCount: 0, photosCount: 0, vehicles: [] };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
  const onUploadStock = vi.fn();
  renderReview({ onUploadStock });
  expect(await screen.findByText('No stock has been saved yet')).toBeInTheDocument();
  expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Upload stock JSON' }));
  expect(onUploadStock).toHaveBeenCalledTimes(1);
});


it('groups identical adjacent opening hours without hiding different day schedules', async () => {
  const result = reviewFixture();
  result.details.hours = [
    { days: 'Monday', times: '09:00–18:00' }, { days: 'Tuesday', times: '09:00–18:00' },
    { days: 'Wednesday', times: '10:00–17:00' }, { days: 'Thursday', times: '09:00–18:00' },
    { days: 'Friday', times: '09:00–18:00' }, { days: 'Saturday', times: '09:00–18:00' }, { days: 'Sunday', times: 'Closed' },
  ];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(result)));
  renderReview();
  expect(await screen.findByText('Mon–Tue')).toBeInTheDocument();
  expect(screen.getByText('Wednesday')).toBeInTheDocument();
  expect(screen.getByText('10:00–17:00')).toBeInTheDocument();
  expect(screen.getByText('Thu–Sat')).toBeInTheDocument();
  expect(screen.getByText('Sunday')).toBeInTheDocument();
});
