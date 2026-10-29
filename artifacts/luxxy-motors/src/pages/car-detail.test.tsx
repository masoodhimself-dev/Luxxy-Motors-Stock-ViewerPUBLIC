import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import CarDetail from '@/pages/car-detail';
import { DEFAULT_PAGE_META } from '@/lib/page-meta';
import { dealerConfig } from '@/config/dealer';
import { getGetDealerSettingsQueryKey } from '@workspace/api-client-react';
import { defaultBookingSettings } from '@/lib/test-drive-dates';



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
    stockStatus: { error: null as string | null, isPhone: false },
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
  useStock: () => ({ stock: stockFixture, isLoading: false, error: stockStatus.error }),
}));

vi.mock('@/components/car-card', () => ({
  CarCard: () => null,
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => stockStatus.isPhone }));

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
  stockStatus.error = null; stockStatus.isPhone = false;
  for (const key of Object.keys(featureState.data.features)) featureState.data.features[key] = false;
});
afterEach(() => vi.unstubAllGlobals());

it('reports a temporary stock error instead of calling the vehicle missing', () => {
  stockStatus.error = 'Network unavailable';
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

it('shares the server-rendered vehicle preview link', async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', Object.create(window.navigator, { share: { value: share } }));
  renderVehicle('with-plate');
  fireEvent.click(screen.getByRole('button', { name: 'Share this vehicle' }));
  await waitFor(() => expect(share).toHaveBeenCalledWith({
    title: 'BMW 3 Series', url: `${window.location.origin}/share/vehicle/with-plate`,
  }));
});

describe('vehicle detail registration', () => {
  it('shows the registration band as ordinary metadata rather than a plate', () => {
    renderVehicle('band-only');

    expect(screen.getByTestId('text-registration-year')).toHaveTextContent('2009 (59 reg)');
    expect(screen.queryByTestId('plate-vehicle-band-only')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^UK registration/)).not.toBeInTheDocument();
  });

  it('shows the supplied registration alongside the vehicle identity', () => {
    renderVehicle('with-plate');

    const plate = screen.getByTestId('plate-vehicle-with-plate');
    expect(plate).toHaveTextContent('NV24 LNZ');
    expect(plate.closest('.vehicle-summary header')).not.toBeNull();
    expect(screen.getByTestId('text-registration-year')).toHaveTextContent('2024 (24 reg)');
  });
});

it('puts one concise identity and price above the gallery on phones', () => {
  stockStatus.isPhone = true;
  renderVehicle('with-plate');
  const identity = screen.getByTestId('vehicle-identity');
  const gallery = document.querySelector('.vehicle-detail-gallery')!;
  expect(identity.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelectorAll('.vehicle-detail-grid h1')).toHaveLength(1);
  expect(identity).toHaveTextContent('BMW 3 Series');
  expect(within(identity).getByRole('list', { name: 'Vehicle details' })).toHaveTextContent('2024 (24 reg)');
  expect(within(identity).getByRole('list', { name: 'Vehicle details' })).toHaveTextContent('90,000 miles');
  expect(within(identity).getByRole('list', { name: 'Vehicle details' })).toHaveTextContent('Manual');
  expect(identity).toHaveTextContent('£4,995');
  expect(identity.closest('.vehicle-summary')).toBeNull();
  expect(screen.getByTestId('plate-vehicle-with-plate').closest('.vehicle-summary')).not.toBeNull();
});

it('keeps the single identity and price in the normal summary on larger screens', () => {
  renderVehicle('with-plate');
  expect(screen.getByTestId('vehicle-identity').closest('.vehicle-summary')).not.toBeNull();
  expect(document.querySelectorAll('.vehicle-detail-grid h1')).toHaveLength(1);
  expect(document.querySelector('.vehicle-compact-identity')).toBeNull();
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

it('offers printing in the vehicle summary', () => {
  renderVehicle('with-plate');
  const link = screen.getByRole('button', { name: 'Print vehicle details for BMW 3 Series' });
  expect(link).toHaveAttribute('type', 'button');
  expect(link.closest('.vehicle-summary')).not.toBeNull();
});

it('requests service records through the contextual enquiry without exposing private uploads', () => {
  renderVehicle('with-plate');
  expect(screen.getByRole('link', { name: /Request service records/ })).toHaveAttribute('href', '/enquire?type=general&vehicleId=with-plate&question=service');
  expect(screen.queryByRole('link', { name: /Download service/ })).not.toBeInTheDocument();
});

it('omits empty extra options while keeping printing and sharing visible', () => {
  window.history.pushState({}, '', '/vehicle/with-plate');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(getGetDealerSettingsQueryKey(), { ...dealerConfig, partExchange: { ...dealerConfig.partExchange, enabled: false }, onlineReservation: { enabled: false, depositPence: 10000, terms: '' }, presentation: { ...dealerConfig.presentation, comparisonEnabled: false } });
  render(<QueryClientProvider client={client}><SavedCarsProvider><CarDetail /></SavedCarsProvider></QueryClientProvider>);
  expect(screen.queryByTestId('vehicle-secondary-actions')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share this vehicle' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Print vehicle details for BMW 3 Series' })).toBeInTheDocument();
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

it('opens the existing car-specific enquiry form and keeps print/share outside collapsed phone options', async () => {
  featureState.data.features.publicEnquiries = true;
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {configurable: true, value: scrollIntoView});
  window.history.replaceState({}, '', '/vehicle/with-plate');
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><SavedCarsProvider><CarDetail /></SavedCarsProvider></QueryClientProvider>);
  const enquiry = await screen.findByRole('link', {name:'Enquire About This Car'});
  expect(enquiry).toHaveAttribute('href','#vehicle-enquiry');
  fireEvent.click(enquiry);
  expect(scrollIntoView).toHaveBeenCalledWith({block:'start', behavior:'smooth'});
  expect(screen.getByRole('heading', {name:'Enquire about this BMW 3 Series'})).toHaveFocus();
  expect(screen.getByRole('button',{name:'Share this vehicle'}).closest('[data-testid="vehicle-secondary-actions"]')).toBeNull();
  expect(screen.queryByText(/Check this car’s registration before driving/)).not.toBeInTheDocument();
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
  const selectTenthPhoto = () => fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  const prompt = () => within(screen.getByRole('region', { name: 'Like what you see?' }));

  beforeEach(() => {
    Object.assign(stockFixture.cars[1], { images: galleryImages, heroImage: galleryImages[0], imageCount: 12, inventoryStatus: 'available' });
  });
  afterEach(() => {
    Object.assign(stockFixture.cars[1], originalCar);
    Reflect.deleteProperty(stockFixture.cars[1], 'inventoryStatus');
  });

  it('offers test-drive, enquiry and configured phone actions for an available car', () => {
    featureState.data.features.testDriveBookings = true;
    featureState.data.features.publicEnquiries = true;
    renderVehicle('with-plate', settings());
    selectTenthPhoto();
    expect(prompt().getByRole('link', { name: 'Book a Test Drive' })).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=with-plate');
    expect(prompt().getByRole('link', { name: 'Ask a question' })).toHaveAttribute('href', '#vehicle-enquiry');
    expect(prompt().getByRole('link', { name: 'Call about BMW 3 Series' })).toHaveAttribute('href', 'tel:07388831790');
  });

  it('keeps enquiry and phone options for reserved cars without offering a test drive', () => {
    featureState.data.features.testDriveBookings = true;
    featureState.data.features.publicEnquiries = true;
    Object.assign(stockFixture.cars[1], { inventoryStatus: 'reserved' });
    renderVehicle('with-plate', settings());
    selectTenthPhoto();
    expect(prompt().queryByRole('link', { name: 'Book a Test Drive' })).not.toBeInTheDocument();
    expect(prompt().getByRole('link', { name: 'Ask a question' })).toHaveAttribute('href', '#vehicle-enquiry');
    expect(prompt().getByRole('link', { name: 'Call about BMW 3 Series' })).toBeInTheDocument();
  });

  it('does not interrupt browsing when both online features are disabled and no phone is configured', () => {
    renderVehicle('with-plate', settings(''));
    selectTenthPhoto();
    expect(screen.getByText('10 / 12 photographs')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  });

  it('offers only the configured phone when platform online features are disabled', () => {
    renderVehicle('with-plate', settings());
    selectTenthPhoto();
    expect(prompt().getByRole('link', { name: 'Call about BMW 3 Series' })).toHaveAttribute('href', 'tel:07388831790');
    expect(prompt().queryByRole('link', { name: 'Book a Test Drive' })).not.toBeInTheDocument();
    expect(prompt().queryByRole('link', { name: 'Ask a question' })).not.toBeInTheDocument();
  });

  it('honours the dealer booking switch even when the platform permits test-drive bookings', () => {
    featureState.data.features.testDriveBookings = true;
    renderVehicle('with-plate', settings('07388831790', false));
    selectTenthPhoto();
    expect(prompt().getByRole('link', { name: 'Call about BMW 3 Series' })).toBeInTheDocument();
    expect(prompt().queryByRole('link', { name: 'Book a Test Drive' })).not.toBeInTheDocument();
    expect(prompt().queryByRole('link', { name: 'Ask a question' })).not.toBeInTheDocument();
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
    expect(screen.getByRole('complementary', { name: 'Verified vehicle tax' })).toHaveTextContent('£17.06');
  } finally { Object.assign(car, previous); }
});

it('removes every main booking and enquiry entry point when the corresponding controls are off', () => {
  featureState.data.features.testDriveBookings = true;
  const view = renderVehicle('with-plate', { ...dealerConfig, testDriveBooking: { ...defaultBookingSettings, enabled: false } });
  expect(view.container.querySelector('[data-vehicle-contact="booking"]')).toBeNull();
  expect(view.container.querySelector('.vehicle-enquiry-action')).toBeNull();
  expect(screen.queryByTestId('form-enquiry')).not.toBeInTheDocument();
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

it('keeps MOT and delivery actions out of the price header and in their own relevant sections', () => {
  renderVehicle('with-plate', {
    ...dealerConfig,
    delivery: { enabled: true, title: 'Delivery to your door', description: 'Ask us about delivery.', ctaLabel: 'Ask about delivery' },
    deliveryPricing: { enabled: true, basePrice: '50', pricePerMile: '1.50' },
  });
  const header = screen.getByTestId('vehicle-identity');
  expect(within(header).queryByRole('button', { name: 'MOT history' })).toBeNull();
  expect(within(header).queryByRole('button', { name: 'Delivery estimate' })).toBeNull();
  expect(screen.getByRole('button', { name: 'MOT history' }).closest('section')).toHaveAttribute('aria-labelledby', 'vehicle-records-heading');
  expect(screen.getByRole('button', { name: 'Delivery estimate' }).closest('section')).toHaveAttribute('aria-labelledby', 'vehicle-delivery-heading');
  expect(screen.getByRole('link', { name: 'History & information' })).toHaveAttribute('href', '#vehicle-records-heading');
  expect(screen.getByRole('link', { name: 'Delivery' })).toHaveAttribute('href', '#vehicle-delivery-heading');
});
