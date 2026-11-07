import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import CarDetail from '@/pages/car-detail';
import { DEFAULT_PAGE_META } from '@/lib/page-meta';
import { dealerConfig } from '@/config/dealer';
import { getGetDealerSettingsQueryKey } from '@workspace/api-client-react';
import { defaultBookingSettings } from '@/lib/test-drive-dates';
import { saveBrowseSession } from '@/lib/browse-session';
import { vehicleMatchesPath } from '@workspace/vehicle-meta';



const featureState = vi.hoisted(() => ({
  data: { features: { testDriveBookings: false, testDriveDeclarations: false, staffAiDrafts: false, customerEmails: false, publicEnquiries: false, partExchange: false } as Record<string, boolean> },
}));
vi.mock('@/lib/dealer-features', () => ({
  useDealerFeatures: () => ({
    data: featureState.data, isLoading: false, isError: false, isSuccess: true,
    enabled: (feature: string) => featureState.data.features[feature] === true,
    refetch: vi.fn(),
  }),
}));

const { stockFixture, stockStatus } = vi.hoisted(() => {
  const baseCar = {
    id: '',
    advertId: '',
    title: '',
    variant: null,
    make: '',
    model: '',
    trim: null,
    year: 2009,
    price: 4995,
    priceType: 'fixed',
    currency: 'GBP',
    mileage: 90000,
    mileageText: null,
    registration: null,
    registrationBand: null,
    plate: null,
    vrm: null,
    vrmVerified: null,
    fuel: 'Petrol',
    transmission: 'Manual',
    bodyType: 'Hatchback',
    engineSize: null,
    engineCC: null,
    doors: 5,
    seats: 5,
    colour: null,
    emissionClass: null,
    drivetrain: null,
    owners: null,
    writeOffCategory: null,
    advertUrl: null,
    dealerName: 'Test Motors',
    dealerLocation: 'Test Town',
    imageCount: 0,
    heroImage: null,
    images: [],
    specifications: null,
    sourceExtras: null,
  };

  const car = (overrides: Record<string, unknown>) => ({ ...baseCar, ...overrides });

  return {
    stockStatus: { error: null as string | null, vehicleError: null as string | null },
    stockFixture: {
      schemaVersion: 1,
      dealerName: 'Test Motors',
      dealerLocation: 'Test Town',
      count: 2,
      scrapedAt: null,
      cars: [
        car({
          id: 'band-only',
          advertId: 'band-only',
          title: 'Ford Fiesta',
          make: 'Ford',
          model: 'Fiesta',
          // The feed copies the registration band into the registration column.
          registration: '2009 (59 REG)',
          registrationBand: '2009 (59 REG)',
        }),
        car({
          id: 'with-plate',
          advertId: 'with-plate',
          title: 'BMW 3 Series',
          make: 'BMW',
          model: '3 Series',
          year: 2024,
          plate: 'NV24 LNZ',
          registration: '2024 (24 REG)',
          registrationBand: '2024 (24 REG)',
          heroImage: 'https://cdn.example.com/bmw-front.jpg',
        }),
      ],
    },
  };
});

vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({
    stock: stockStatus.error ? null : stockFixture,
    vehicle: stockFixture.cars.find(car => vehicleMatchesPath(car, window.location.pathname)) ?? null,
    isVehicleLoading: false,
    vehicleError: stockStatus.vehicleError,
    retryVehicle: vi.fn(),
  }),
}));

vi.mock('@/components/car-card', () => ({
  CarCard: () => null,
}));

function renderVehicle(id: string, settings?: typeof dealerConfig & { testDriveBooking?: typeof defaultBookingSettings }) {
  window.history.pushState({}, '', `/vehicle/${id}`);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, ...(settings ? { staleTime: Infinity } : {}) } } });
  if (settings) queryClient.setQueryData(getGetDealerSettingsQueryKey(), settings);
  return render(
    <QueryClientProvider client={queryClient}>
      <SavedCarsProvider><CarDetail /></SavedCarsProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  stockStatus.error = null;
  stockStatus.vehicleError = null;
  window.sessionStorage.clear();
  for (const key of Object.keys(featureState.data.features)) featureState.data.features[key] = false;
});
afterEach(() => vi.unstubAllGlobals());

it('reports a temporary vehicle error instead of calling the car missing', () => {
  stockStatus.vehicleError = 'Network unavailable';
  renderVehicle('with-plate');
  expect(screen.getByRole('heading', { name: 'Vehicle details could not be loaded' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /not found/i })).not.toBeInTheDocument();
  expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(/^noindex/);
  expect(document.querySelector('link[rel="canonical"]')).toBeNull();
});

it('keeps an unavailable vehicle out of search metadata when reached without a new document request', () => {
  renderVehicle('not-in-stock');
  expect(screen.getByRole('heading', { name: 'This car isn’t in our current stock' })).toBeInTheDocument();
  expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toMatch(/^noindex/);
  expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  expect(document.querySelector('meta[property="og:url"]')).toBeNull();
});

it('shows the individual vehicle even if the full stock request failed', () => {
  stockStatus.error = 'Network unavailable';
  renderVehicle('with-plate');
  expect(screen.getByRole('heading', { level: 1, name: 'BMW 3 Series' })).toBeInTheDocument();
  expect(document.querySelector('.vehicle-price-block')).toHaveTextContent('£4,995');
});

it.each([
  ['', 'Back to stock', '/stock'],
  ['?from=stock', 'Back to your results', '/stock?make=BMW'],
  ['?from=saved', 'Back to saved cars', '/saved'],
  ['?from=https%3A%2F%2Fother.example', 'Back to stock', '/stock'],
])('offers the correct return link for a vehicle entry %s', (query, label, href) => {
  saveBrowseSession({ stockHref: '/stock?make=BMW' });
  renderVehicle(`with-plate${query}`);
  expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
});

it('shares the server-rendered vehicle preview link', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', Object.create(window.navigator, { share: { value: share } }));
  renderVehicle('with-plate');
  fireEvent.click(screen.getByRole('button', { name: 'Share this vehicle' }));
  expect(screen.getByRole('dialog', { name: 'Share this car' })).toBeInTheDocument();
  expect(share).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'More apps' }));
  await waitFor(() => expect(share).toHaveBeenCalledWith({
    title: 'BMW 3 Series', text: 'BMW 3 Series · £4,995', url: `${window.location.origin}/share/vehicle/with-plate`,
  }));
});

describe('vehicle detail registration', () => {
  it('shows the registration band as ordinary metadata rather than a plate', () => {
    renderVehicle('band-only');

    expect(screen.getByTestId('text-registration-year')).toHaveTextContent('2009 (59 reg)');
    expect(screen.queryByTestId('plate-vehicle-band-only')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^UK registration/)).not.toBeInTheDocument();
  });

  it('shows the supplied registration in the vehicle summary', () => {
    renderVehicle('with-plate');

    const plate = screen.getByTestId('plate-vehicle-with-plate');
    expect(plate).toHaveTextContent('NV24 LNZ');
    expect(plate.closest('.vehicle-summary')).not.toBeNull();
    expect(screen.getByTestId('text-registration-year')).toHaveTextContent('2024 (24 reg)');
  });
});

it('puts one identity above the gallery and groups the price and key facts in the summary', () => {
  renderVehicle('with-plate');
  const identity = screen.getByTestId('vehicle-identity');
  const gallery = document.querySelector('.vehicle-detail-gallery')!;
  const summary = document.querySelector<HTMLElement>('.vehicle-summary')!;
  expect(identity.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelectorAll('.vehicle-detail-grid h1')).toHaveLength(1);
  expect(identity).toHaveTextContent('BMW 3 Series');
  expect(summary.querySelector('.vehicle-price-block')).toHaveTextContent('£4,995');
  const facts = within(summary).getByText('Year', { exact: true }).closest('dl');
  expect(facts).toHaveTextContent('2024 (24 reg)');
  expect(facts).toHaveTextContent('90,000 miles');
  expect(facts).toHaveTextContent('Manual');
});

describe('vehicle detail link preview', () => {
  const tag = (selector: string) => document.head.querySelector(selector)?.getAttribute('content') ?? null;

  it('titles the page after the vehicle and previews its photograph', () => {
    renderVehicle('with-plate');

    expect(document.title).toBe('2024 BMW 3 Series — £4,995 | Luxxy Motors');
    expect(tag('meta[property="og:title"]')).toBe('2024 BMW 3 Series — £4,995 | Luxxy Motors');
    expect(tag('meta[property="og:image"]')).toBe('https://cdn.example.com/bmw-front.jpg');
    expect(tag('meta[name="description"]')).toContain('90,000 miles');
  });

  it('restores the showroom title and drops the car photo on leaving the page', () => {
    const view = renderVehicle('with-plate');
    view.unmount();

    expect(document.title).toBe(DEFAULT_PAGE_META.title);
    expect(tag('meta[property="og:image"]')).toBeNull();
  });
});

it('offers printing inside the share menu', () => {
  renderVehicle('with-plate');
  fireEvent.click(screen.getByRole('button', { name: 'Share this vehicle' }));
  fireEvent.click(screen.getByText('More ways to share'));
  const link = screen.getByRole('button', { name: 'Print or download details for BMW 3 Series' });
  expect(link).toHaveAttribute('type', 'button');
  expect(link.closest('[role="dialog"]')).not.toBeNull();
});

it('places one decorative make mark beside the Multi-Choice vehicle title', () => {
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = 'https://multichoicemotors.co.uk';
  meta.setAttribute('data-page-meta', '');
  document.head.append(meta);
  try {
    const view = renderVehicle('with-plate');
    const title = screen.getByRole('heading', { level: 1, name: 'BMW 3 Series' });
    const logo = title.querySelector('img');
    expect(logo).toHaveAttribute('src', '/brand/car-makes/bmw.svg');
    expect(logo).toHaveAttribute('width', '28');
    expect(logo).toHaveAttribute('alt', '');
    expect(logo).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelectorAll('h1 img[src*="car-makes"]')).toHaveLength(1);
    expect(document.querySelector('.vehicle-detail-gallery img[src*="car-makes"]')).toBeNull();
    view.unmount();
  } finally { meta.remove(); }
});

it('shares the decorative manufacturer mark across all dealerships', () => {
  renderVehicle('with-plate');
  const title = screen.getByRole('heading', { level: 1, name: 'BMW 3 Series' });
  expect(title.querySelector('img')).toHaveAttribute('src', '/brand/car-makes/bmw.svg');
  expect(title).toHaveClass('make-logo-vehicle-heading');
});

it('retains Multi-Choice vehicle-page Save and full gallery browsing independently from stock-photo controls', async () => {
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = 'https://multichoicemotors.co.uk';
  meta.setAttribute('data-page-meta', '');
  document.head.append(meta);
  const car = stockFixture.cars[1];
  const previous = { images: car.images, imageCount: car.imageCount };
  window.localStorage.clear();
  Object.assign(car, { images: [car.heroImage, 'https://cdn.example.com/bmw-rear.jpg'], imageCount: 2 });
  try {
    const view = renderVehicle('with-plate');
    const save = screen.getByTestId('button-save-with-plate');
    expect(save).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(save);
    expect(save).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
    expect(screen.getByText('2 / 2', { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(within(dialog).getByText('1 / 2', { exact: true })).toBeInTheDocument();
    view.unmount();
  } finally {
    Object.assign(car, previous);
    meta.remove();
    window.localStorage.clear();
  }
});

it('prepares a service-record request in the same-page message form without sending it', async () => {
  featureState.data.features.publicEnquiries = true;
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  renderVehicle('with-plate');
  const disclosure = document.getElementById('vehicle-enquiry') as HTMLDetailsElement;
  expect(disclosure.open).toBe(false);
  expect(screen.queryByRole('link', { name: /Download service/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Request service records/ }));
  await waitFor(() => expect(disclosure.open).toBe(true));
  await waitFor(() => expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('Please send the available service-book photos and service records for this car.'));
  expect(screen.getByTestId('form-enquiry')).toBeVisible();
  expect(window.location.pathname).toBe('/vehicle/with-plate');
  expect(screen.queryByTestId('status-enquiry-success')).not.toBeInTheDocument();
});

it('shows vehicle context only with the expanded message form and retains the unsent draft when closed', async () => {
  featureState.data.features.publicEnquiries = true;
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'not_connected' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  renderVehicle('with-plate', { ...dealerConfig, identity: { ...dealerConfig.identity, name: 'This Dealer' }, presentation: { includedItems: ['6 months warranty'] } });
  const disclosure = document.getElementById('vehicle-enquiry') as HTMLDetailsElement;
  expect(screen.queryByTestId('vehicle-enquiry-information')).not.toBeInTheDocument();
  fireEvent.click(within(document.querySelector('.vehicle-summary-main-actions') as HTMLElement).getByRole('link', { name: 'Message' }));
  const sidebar = await screen.findByTestId('vehicle-enquiry-information');
  expect(within(sidebar).getByRole('heading', { name: 'BMW 3 Series' })).toBeInTheDocument();
  expect(sidebar).toHaveTextContent('6 months warranty');
  expect(sidebar).toHaveTextContent('Why choose This Dealer');
  const message = screen.getByTestId('textarea-enquiry-message');
  fireEvent.change(message, { target: { value: 'Can I see this car on Saturday?' } });
  await act(async () => { disclosure.open = false; fireEvent(disclosure, new Event('toggle')); });
  await waitFor(() => expect(screen.queryByTestId('vehicle-enquiry-information')).not.toBeInTheDocument());
  fireEvent.click(within(document.querySelector('.vehicle-summary-main-actions') as HTMLElement).getByRole('link', { name: 'Message' }));
  await screen.findByTestId('vehicle-enquiry-information');
  expect(screen.getByTestId('textarea-enquiry-message')).toBe(message);
  expect(message).toHaveValue('Can I see this car on Saturday?');
  expect(screen.queryByTestId('status-enquiry-success')).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it('keeps service and part-exchange contact routes usable when online enquiries are disabled', () => {
  featureState.data.features.partExchange = true;
  renderVehicle('with-plate', { ...dealerConfig, partExchange: { ...dealerConfig.partExchange!, enabled: true } });
  expect(screen.getByRole('link', { name: 'Contact the showroom about service records' })).toHaveAttribute('href', '/contact');
  expect(screen.getByRole('link', { name: /Part exchange your car/ })).toHaveAttribute('href', '/contact');
  expect(screen.queryByRole('button', { name: 'Quick answers' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Request service records/ })).not.toBeInTheDocument();
  expect(screen.queryByTestId('form-enquiry')).not.toBeInTheDocument();
});

it('keeps sharing visible and groups printing inside it', () => {
  window.history.pushState({}, '', '/vehicle/with-plate');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(getGetDealerSettingsQueryKey(), { ...dealerConfig, partExchange: { ...dealerConfig.partExchange, enabled: false }, onlineReservation: { enabled: false, depositPence: 10000, terms: '' }, presentation: { ...dealerConfig.presentation, comparisonEnabled: false } });
  render(<QueryClientProvider client={client}><SavedCarsProvider><CarDetail /></SavedCarsProvider></QueryClientProvider>);
  expect(screen.queryByTestId('vehicle-secondary-actions')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share this vehicle' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Share this vehicle' }));
  fireEvent.click(screen.getByText('More ways to share'));
  expect(screen.getByRole('button', { name: 'Print or download details for BMW 3 Series' })).toBeInTheDocument();
});

it('discloses a supplied insurance category alongside the price without inferring it from prose', () => {
  const car = stockFixture.cars[1];
  Object.assign(car, { writeOffCategory: 'S' });
  try {
    const view = renderVehicle('with-plate');
    const disclosure = screen.getByRole('link', { name: /Category S · recorded insurance history/ });
    expect(disclosure.closest('.vehicle-price-block')).not.toBeNull();
    expect(disclosure).toHaveAttribute('href', '#vehicle-history');
    view.unmount();
  } finally { Object.assign(car, { writeOffCategory: null }); }
  renderVehicle('with-plate');
  expect(screen.queryByRole('link', { name: /recorded insurance history/ })).not.toBeInTheDocument();
});

it('adds a service-record request to the message form without losing an existing draft', async () => {
  featureState.data.features.publicEnquiries = true;
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  renderVehicle('with-plate');
  const disclosure = document.getElementById('vehicle-enquiry') as HTMLDetailsElement;
  expect(disclosure.open).toBe(false);
  fireEvent.click(within(document.querySelector('.vehicle-summary-main-actions') as HTMLElement).getByRole('link', { name: 'Message' }));
  const message = screen.getByTestId('textarea-enquiry-message');
  await waitFor(() => expect(disclosure.open).toBe(true));
  fireEvent.change(message, { target: { value: 'I would like to visit on Saturday.' } });
  fireEvent.click(screen.getByRole('button', { name: /Request service records/ }));
  await waitFor(() => expect(message).toHaveValue('I would like to visit on Saturday.\n\nPlease send the available service-book photos and service records for this car.'));
  // The destination page also schedules a focus/scroll frame. Check the final
  // destination after that frame, rather than the form's earlier draft effect.
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  expect(disclosure.open).toBe(true);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
  expect(message).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Share this vehicle' }).closest('[data-testid="vehicle-secondary-actions"]')).toBeNull();
  expect(screen.queryByTestId('status-enquiry-success')).not.toBeInTheDocument();
});

it('shows an explicit advert category as an unconfirmed advert disclosure beside the price', () => {
  const car = stockFixture.cars[1];
  try {
    Object.assign(car, {sourceExtras: {description:'This car is recorded as Cat S. Ask for repair records.'}});
    renderVehicle('with-plate');
    const link = screen.getByRole('link', {name:/Advert states Category S · read the insurance history/});
    expect(link.closest('.vehicle-price-block')).not.toBeNull();
    expect(screen.getByText(/Its structured insurance-history field has not confirmed that category/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /^Mileage/})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /^Fuel/})).not.toBeInTheDocument();
  } finally { Object.assign(car, {sourceExtras: null}); }
});

it('shows a supplied nested category beside the price and never promotes a description into a verified category', () => {
  const car = stockFixture.cars[1];
  try {
    Object.assign(car, { specifications: { writeOffCategory: 'Cat N' } });
    const view = renderVehicle('with-plate');
    expect(screen.getByRole('link', { name: /Category N · recorded insurance history/ }).closest('.vehicle-price-block')).not.toBeNull();
    view.unmount();
    Object.assign(car, { specifications: null, sourceExtras: { description: 'Seller says Cat S; ask for records.' } });
    renderVehicle('with-plate');
    expect(document.querySelector('.vehicle-description-copy')).toHaveTextContent('Seller says Cat S; ask for records.');
    expect(screen.queryByRole('link', { name: /recorded insurance history/ })).not.toBeInTheDocument();
  } finally { Object.assign(car, { specifications: null, sourceExtras: null }); }
});

describe('vehicle gallery contact policy', () => {
  const galleryImages = Array.from({ length: 12 }, (_, i) => `https://example.com/contact-policy-${i + 1}.jpg`);
  const originalCar = { ...stockFixture.cars[1] };
  const settings = (phone = '07388831790', bookingEnabled = true) => ({
    ...dealerConfig,
    contact: { ...dealerConfig.contact, phone, whatsapp: '' },
    testDriveBooking: { ...defaultBookingSettings, enabled: bookingEnabled },
  });
  const selectTenthPhoto = () => {
    const next = screen.getByRole('button', { name: 'Next photograph' });
    for (let photo = 1; photo < 10; photo++) fireEvent.click(next);
  };
  const primaryActions = () => document.querySelector('.vehicle-primary-actions') as HTMLElement;
  const expectUninterruptedGallery = () => {
    expect(screen.getByText('10 / 12', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Like what you see?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  };

  beforeEach(() => {
    Object.assign(stockFixture.cars[1], { images: galleryImages, heroImage: galleryImages[0], imageCount: 12, inventoryStatus: 'available' });
  });
  afterEach(() => {
    Object.assign(stockFixture.cars[1], originalCar);
    Reflect.deleteProperty(stockFixture.cars[1], 'inventoryStatus');
  });

  it('keeps available-car booking and manual messaging beside the car while photo browsing remains uninterrupted', async () => {
    featureState.data.features.testDriveBookings = true;
    featureState.data.features.publicEnquiries = true;
    renderVehicle('with-plate', settings());
    expect(document.querySelector('.vehicle-price-block [data-vehicle-contact="booking"]')).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=with-plate');
    expect(within(primaryActions()).getByRole('link', { name: 'Message' })).toHaveAttribute('href', '#vehicle-enquiry');
    selectTenthPhoto();
    expectUninterruptedGallery();
    expect((document.getElementById('vehicle-enquiry') as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(within(primaryActions()).getByRole('link', { name: 'Message' }));
    await waitFor(() => expect((document.getElementById('vehicle-enquiry') as HTMLDetailsElement).open).toBe(true));
    expect(screen.getByTestId('form-enquiry')).toBeVisible();
    expect(screen.queryByTestId('status-enquiry-success')).not.toBeInTheDocument();
  });

  it('opens the manual message form from fullscreen without treating an animation-frame timestamp as message text', async () => {
    featureState.data.features.publicEnquiries = true;
    const originalFrame = globalThis.requestAnimationFrame.bind(globalThis);
    const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => originalFrame(() => callback(123456.75)));
    try {
      renderVehicle('with-plate', settings());
      selectTenthPhoto();
      fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('link', { name: 'Message' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await waitFor(() => expect((document.getElementById('vehicle-enquiry') as HTMLDetailsElement).open).toBe(true));
      expect(screen.getByTestId('form-enquiry')).toBeVisible();
      expect(screen.getByTestId('textarea-enquiry-message')).toHaveValue('');
      expect(window.location.pathname).toBe('/vehicle/with-plate');
      expect(screen.queryByTestId('status-enquiry-success')).not.toBeInTheDocument();
    } finally { frame.mockRestore(); }
  });

  it('keeps manual messaging for reserved cars without offering a test drive', async () => {
    featureState.data.features.testDriveBookings = true;
    featureState.data.features.publicEnquiries = true;
    Object.assign(stockFixture.cars[1], { inventoryStatus: 'reserved' });
    renderVehicle('with-plate', settings());
    expect(document.querySelector('.vehicle-price-block [data-vehicle-contact="booking"]')).toBeNull();
    selectTenthPhoto();
    expectUninterruptedGallery();
    fireEvent.click(within(primaryActions()).getByRole('link', { name: 'Message' }));
    await waitFor(() => expect(screen.getByTestId('form-enquiry')).toBeVisible());
  });

  it('removes every online enquiry and photo-request handoff when features are disabled, including fullscreen', async () => {
    renderVehicle('with-plate', settings(''));
    selectTenthPhoto();
    expectUninterruptedGallery();
    expect(document.querySelector('.vehicle-price-block [data-vehicle-contact="booking"]')).toBeNull();
    expect(screen.queryByTestId('form-enquiry')).not.toBeInTheDocument();
    expect(document.querySelector('.vehicle-photo-request')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick answers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Contact about this vehicle' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('link', { name: 'Message' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('link', { name: /Call/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText('10 / 12', { exact: true })).toBeInTheDocument();
  });

  it('keeps only configured phone contact when platform online features are disabled', () => {
    renderVehicle('with-plate', settings());
    selectTenthPhoto();
    expectUninterruptedGallery();
    expect(document.querySelector('.vehicle-action-tools a')).toHaveAttribute('href', 'tel:07388831790');
    expect(document.querySelector('.vehicle-price-block [data-vehicle-contact="booking"]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quick answers' })).not.toBeInTheDocument();
    const sticky = screen.getByRole('navigation', { name: 'Contact about this vehicle' });
    expect(within(sticky).getByRole('link', { name: /Call/ })).toBeInTheDocument();
    expect(within(sticky).queryByRole('link', { name: 'Message' })).not.toBeInTheDocument();
  });

  it('honours the dealer booking switch independently from manual messages', () => {
    featureState.data.features.testDriveBookings = true;
    featureState.data.features.publicEnquiries = true;
    renderVehicle('with-plate', settings('07388831790', false));
    selectTenthPhoto();
    expectUninterruptedGallery();
    expect(document.querySelector('.vehicle-price-block [data-vehicle-contact="booking"]')).toBeNull();
    expect(within(primaryActions()).getByRole('link', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Questions about this car' })).toBeInTheDocument();
  });
});

it('keeps a separate write-off disclosure visible and shows a verified tax estimate beside the narrative', () => {
  const car = stockFixture.cars[1];
  const previous = { specifications: car.specifications, sourceExtras: car.sourceExtras };
  const narrative = 'A five-door car with a manual gearbox and useful recorded equipment.';
  const disclosure = 'Recorded as Category S. The original advert reports repairs.';
  try {
    Object.assign(car, { specifications: { description: `${narrative}\n\nImportant information\n${disclosure}` }, sourceExtras: { vehicleDescriptionPlacement: 'separate', vehicleDescriptionBody: narrative, vehicleDescriptionDisclosures: [disclosure], vehicleDescriptionTax: 'Vehicle tax: £195 a year, approximately £17.06 a month by Direct Debit including the 5% surcharge.' } });
    renderVehicle('with-plate');
    const notes = screen.getByRole('complementary', { name: 'Vehicle history and important information' });
    expect(notes).toBeVisible(); expect(notes).toHaveTextContent(disclosure); expect(notes.closest('details')).toBeNull();
    expect(screen.getByText(narrative, { exact: true })).toBeVisible();
    expect(screen.getByRole('complementary', { name: 'Vehicle tax information' })).toHaveTextContent('£17.06');
  } finally { Object.assign(car, previous); }
});

it('removes every main booking and enquiry entry point when the corresponding controls are off', () => {
  featureState.data.features.testDriveBookings = true;
  const view = renderVehicle('with-plate', { ...dealerConfig, testDriveBooking: { ...defaultBookingSettings, enabled: false } });
  expect(view.container.querySelector('[data-vehicle-contact="booking"]')).toBeNull();
  expect(view.container.querySelector('.vehicle-enquiry-action')).toBeNull();
  expect(screen.queryByTestId('form-enquiry')).not.toBeInTheDocument();
  expect(document.querySelector('.vehicle-photo-request')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Quick answers' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share this vehicle' })).toBeInTheDocument();
});

it('renders valid Cazoo vehicle checks without a demo-host-only presentation gate', () => {
  const car = stockFixture.cars[1];
  const original = { advertId: car.advertId, advertUrl: car.advertUrl, sourceExtras: car.sourceExtras };
  Object.assign(car, { advertId: '80238245', advertUrl: 'https://www.cazoo.co.uk/cars-for-sale/80238245/', sourceExtras: {
    sourcePlatform: 'cazoo', sourceReport: { version: 1, platform: 'cazoo', sourceUrl: 'https://www.cazoo.co.uk/cars-for-sale/80238245/', capturedAt: '2026-01-01T00:00:00Z', ulez: { status: 'compliant', sourceText: 'ULEZ Compliant' }, history: null },
  } });
  try {
    renderVehicle('with-plate');
    expect(screen.getByRole('region', { name: 'Vehicle checks' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ULEZ compliant' })).toBeInTheDocument();
  } finally { Object.assign(car, original); }
});

it('groups the vehicle information into clear chapters and keeps technical details collapsed initially', () => {
  renderVehicle('with-plate');
  const navigation = screen.getByRole('navigation', { name: 'Vehicle information sections' });
  expect(within(navigation).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '#vehicle-overview-section');
  expect(within(navigation).getByRole('link', { name: 'History' })).toHaveAttribute('href', '#vehicle-history-section');
  expect(within(navigation).getByRole('link', { name: 'Visit & delivery' })).toHaveAttribute('href', '#vehicle-visit-delivery');
  expect(within(navigation).queryByRole('link', { name: 'Equipment' })).not.toBeInTheDocument();
  for (const link of within(navigation).getAllByRole('link')) expect(document.querySelector(link.getAttribute('href')!)).not.toBeNull();
  const disclosure = document.querySelector('.vehicle-technical-disclosure') as HTMLDetailsElement;
  expect(disclosure).not.toBeNull();
  expect(disclosure.open).toBe(false);
  expect(within(disclosure).getByText('Specifications & running costs', { exact: true })).toBeVisible();
  fireEvent.click(within(disclosure).getByText('Specifications & running costs', { exact: true }));
  expect(disclosure.open).toBe(true);
  fireEvent.click(within(disclosure).getByText('Specifications & running costs', { exact: true }));
  expect(disclosure.open).toBe(false);
});

it('adds the Equipment chapter only when supplied equipment exists', () => {
  const car = stockFixture.cars[1];
  const original = car.specifications;
  Object.assign(car, { specifications: { features: ['Heated front seats', 'Rear parking sensors'] } });
  try {
    renderVehicle('with-plate');
    const navigation = screen.getByRole('navigation', { name: 'Vehicle information sections' });
    const equipment = within(navigation).getByRole('link', { name: 'Equipment' });
    expect(equipment).toHaveAttribute('href', '#features-heading');
    expect(document.querySelector(equipment.getAttribute('href')!)).not.toBeNull();
    expect(document.querySelector('.vehicle-features-section')).toHaveTextContent('Heated front seats');
    expect(document.querySelector('.vehicle-features-section')).toHaveTextContent('Rear parking sensors');
  } finally { Object.assign(car, { specifications: original }); }
});

it('omits the Overview link and chapter when the feed has no overview content', () => {
  const car = stockFixture.cars[1];
  const original = { ...car };
  Object.assign(car, { bodyType: null, engineSize: null, engineCC: null, doors: null, seats: null, colour: null, drivetrain: null, emissionClass: null, specifications: null, sourceExtras: null, description: '   ', includedItems: null });
  try {
    renderVehicle('with-plate', dealerConfig);
    const navigation = screen.getByRole('navigation', { name: 'Vehicle information sections' });
    expect(within(navigation).queryByRole('link', { name: 'Overview' })).not.toBeInTheDocument();
    expect(document.getElementById('vehicle-overview-section')).toBeNull();
    expect(within(navigation).getByRole('link', { name: 'History' })).toHaveAttribute('href', '#vehicle-history-section');
    for (const link of within(navigation).getAllByRole('link')) expect(document.querySelector(link.getAttribute('href')!)).not.toBeNull();
  } finally {
    Object.assign(car, original);
    for (const key of Object.keys(car)) if (!Object.hasOwn(original, key)) Reflect.deleteProperty(car, key);
  }
});

it('shows default-enabled booking consistently at the top and in Visit when no explicit booking config exists', () => {
  featureState.data.features.testDriveBookings = true;
  renderVehicle('with-plate', dealerConfig);
  expect(document.querySelector('[data-vehicle-contact="booking"]')).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=with-plate');
  expect(screen.getByRole('link', { name: 'Choose a test-drive time' })).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=with-plate');
});

it('keeps both default booking entries absent when the dealership feature is disabled', () => {
  featureState.data.features.testDriveBookings = false;
  renderVehicle('with-plate', dealerConfig);
  expect(document.querySelector('[data-vehicle-contact="booking"]')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Choose a test-drive time' })).not.toBeInTheDocument();
});

it('keeps MOT in History and makes both delivery entries open the same estimate dialog', async () => {
  renderVehicle('with-plate', {
    ...dealerConfig,
    delivery: { enabled: true, title: 'Delivery to your door', description: 'Ask us about delivery.', ctaLabel: 'Ask about delivery' },
    deliveryPricing: { enabled: true, basePrice: '50', pricePerMile: '1.50' },
  });
  const header = screen.getByTestId('vehicle-identity');
  expect(within(header).queryByRole('button', { name: 'MOT history' })).toBeNull();
  expect(within(header).queryByRole('button', { name: 'Delivery estimate' })).toBeNull();
  expect(screen.getByRole('button', { name: 'MOT history' }).closest('section')).toHaveAttribute('aria-labelledby', 'vehicle-records-heading');
  fireEvent.click(document.querySelector('.vehicle-buying-options summary') as HTMLElement);
  const early = within(document.querySelector('.vehicle-buying-options') as HTMLElement).getByRole('button', { name: 'Delivery estimate' });
  const later = within(screen.getByRole('region', { name: 'Delivery to your door' })).getByRole('button', { name: 'Delivery estimate' });
  expect(screen.getAllByRole('button', { name: 'Delivery estimate' })).toHaveLength(2);
  for (const action of [early, later]) {
    fireEvent.click(action);
    const dialog = await screen.findByRole('dialog', { name: 'Delivery estimate' });
    expect(dialog).toBeVisible();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delivery estimate' })).not.toBeInTheDocument());
  }
});

it('keeps mobile contact to Call and Message while respecting enquiry permissions', () => {
  featureState.data.features.publicEnquiries = true;
  featureState.data.features.testDriveBookings = true;
  const view = renderVehicle('with-plate', { ...dealerConfig, testDriveBooking: { ...defaultBookingSettings, enabled: true } });
  const actions = screen.getByRole('navigation', { name: 'Contact about this vehicle' });
  expect(within(actions).getByRole('link', { name: 'Message' })).toHaveAttribute('href', '#vehicle-enquiry');
  expect(within(actions).getByRole('link', { name: /Call for/ })).toBeInTheDocument();
  expect(within(actions).queryByRole('link', { name: /Book/ })).not.toBeInTheDocument();
  view.unmount();
  featureState.data.features.publicEnquiries = false;
  renderVehicle('with-plate', { ...dealerConfig, testDriveBooking: { ...defaultBookingSettings, enabled: false } });
  expect(within(screen.getByRole('navigation', { name: 'Contact about this vehicle' })).queryByRole('link', { name: 'Message' })).not.toBeInTheDocument();
});


describe('dealership-wide What’s included', () => {
  const restoreCar = (car: typeof stockFixture.cars[number], original: typeof car) => {
    Object.assign(car, original);
    for (const key of Object.keys(car)) if (!Object.hasOwn(original, key)) Reflect.deleteProperty(car, key);
  };

  it.each(['band-only', 'with-plate'])('shows the same saved dealership inclusions for %s instead of inferred car inclusions', id => {
    const car = stockFixture.cars.find(item => item.id === id)!;
    const original = { ...car };
    Object.assign(car, { description: id === 'band-only' ? '3 months warranty included.' : '12 months warranty included.', includedItems: ['Feed-only handbook'] });
    const settings = {
      ...dealerConfig,
      identity: { ...dealerConfig.identity, name: 'Current Dealer' },
      presentation: { ...dealerConfig.presentation, includedItems: ['6 months warranty', '12 months roadside assistance'], includedInformation: 'Please bring photo identification to handover.' },
    };
    const before = JSON.stringify(settings);
    try {
      renderVehicle(id, settings);
      const section = screen.getByRole('region', { name: 'What’s included' });
      expect(within(section).getAllByRole('listitem').map(item => item.textContent)).toEqual(['6 months warranty', '12 months roadside assistance']);
      expect(section).not.toHaveTextContent('Feed-only handbook');
      expect(section).not.toHaveTextContent('3-month warranty included');
      expect(section).not.toHaveTextContent('12-month warranty included');
      expect(screen.getByText('Please bring photo identification to handover.').closest('section')).not.toBe(section);
      expect(JSON.stringify(settings)).toBe(before);
    } finally { restoreCar(car, original); }
  });

  it('hides the inclusion section for an explicitly empty dealership list despite feed warranty claims', () => {
    const car = stockFixture.cars[1];
    const original = { ...car };
    Object.assign(car, { description: '3 months warranty included.', includedItems: ['Feed-only handbook'] });
    try {
      renderVehicle(car.id, { ...dealerConfig, presentation: { ...dealerConfig.presentation, includedItems: [] } });
      expect(screen.queryByRole('region', { name: 'What’s included' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'What’s included' })).not.toBeInTheDocument();
    } finally { restoreCar(car, original); }
  });

  it('retains inferred car inclusions for a dealership without the new setting', () => {
    const car = stockFixture.cars[1];
    const original = { ...car };
    Object.assign(car, { description: '3 months warranty included.', includedItems: ['Owner handbook'] });
    const presentation = { ...dealerConfig.presentation };
    delete presentation.includedItems;
    try {
      renderVehicle(car.id, { ...dealerConfig, presentation });
      const section = screen.getByRole('region', { name: 'What’s included' });
      expect(within(section).getAllByRole('listitem').map(item => item.textContent)).toEqual(['3-month warranty included', 'Owner handbook']);
    } finally { restoreCar(car, original); }
  });

  it('uses only the active dealership’s saved list and does not keep a previous dealer’s inclusion claims', () => {
    const first = { ...dealerConfig, identity: { ...dealerConfig.identity, name: 'First Dealer' }, presentation: { ...dealerConfig.presentation, includedItems: ['First dealer warranty promise'] } };
    const second = { ...dealerConfig, identity: { ...dealerConfig.identity, name: 'Second Dealer' }, presentation: { ...dealerConfig.presentation, includedItems: ['Second dealer preparation check'] } };
    const before = JSON.stringify({ first, second });
    const view = renderVehicle('with-plate', first);
    expect(screen.getByRole('region', { name: 'What’s included' })).toHaveTextContent('First dealer warranty promise');
    view.unmount();
    renderVehicle('band-only', second);
    const section = screen.getByRole('region', { name: 'What’s included' });
    expect(within(section).getAllByRole('listitem').map(item => item.textContent)).toEqual(['Second dealer preparation check']);
    expect(section).not.toHaveTextContent('First dealer warranty promise');
    expect(JSON.stringify({ first, second })).toBe(before);
  });
});

it('puts the live £99 action below the price box and requires acceptance before opening secure checkout', async () => {
  const terms = 'The £99 deposit is fully refundable. Contact us to cancel.';
  let enabled = true;
  const checkoutCalls: Array<Record<string, unknown>> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/reservations/payment-readiness') return Response.json(enabled ? { enabled, depositPence: 9900, terms } : { enabled });
    if (url === '/api/reservations/checkout') {
      checkoutCalls.push(JSON.parse(String(options?.body)));
      return Response.json({ error: 'Secure payment is temporarily unavailable.' }, { status: 503 });
    }
    return Response.json({ error: 'Unavailable' }, { status: 503 });
  }));
  renderVehicle('with-plate');
  const opener = await screen.findByRole('button', { name: 'Reserve this car for £99' });
  expect(opener.closest('.vehicle-reserve')?.previousElementSibling).toHaveClass('vehicle-summary');
  expect(opener).toHaveAccessibleDescription('£99 deposit · Fully refundable');
  fireEvent.click(opener);
  const dialog = within(screen.getByRole('dialog'));
  const submit = dialog.getByRole('button', { name: 'Continue to £99 payment' });
  expect(submit).toBeDisabled();
  expect(dialog.getByText(terms)).toBeVisible();
  fireEvent.change(dialog.getByLabelText('Your name'), { target: { value: 'Jamie Patel' } });
  fireEvent.change(dialog.getByLabelText('Email address'), { target: { value: 'jamie@example.test' } });
  fireEvent.change(dialog.getByLabelText('Phone number'), { target: { value: '07700 900123' } });
  fireEvent.click(dialog.getByRole('checkbox', { name: 'I accept the reservation terms.' }));
  fireEvent.click(submit);
  expect(await dialog.findByRole('alert')).toHaveTextContent('Secure payment is temporarily unavailable.');
  expect(checkoutCalls).toEqual([{
    vehicleId: 'with-plate', customerName: 'Jamie Patel', email: 'jamie@example.test', phone: '07700900123',
    expectedPricePence: 499500, expectedDepositPence: 9900, termsAccepted: true, terms,
    idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
  }]);
  fireEvent.click(submit);
  await waitFor(() => expect(checkoutCalls).toHaveLength(2));
  expect(checkoutCalls[1]).toEqual(checkoutCalls[0]);
  enabled = false;
  fireEvent.click(submit);
  expect(await screen.findByRole('dialog', { name: 'Online reservations unavailable' })).toBeVisible();
  expect(document.querySelector('.vehicle-reserve')).toBeNull();
});

it('hides the reserve action when the live payment service is unavailable', async () => {
  const fetchMock = vi.fn(async (url: string) => url === '/api/reservations/payment-readiness'
    ? Response.json({ enabled: false })
    : Response.json({ error: 'Unavailable' }, { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  renderVehicle('with-plate');
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/reservations/payment-readiness', expect.anything()));
  expect(screen.queryByRole('button', { name: /Reserve this car/ })).not.toBeInTheDocument();
});
