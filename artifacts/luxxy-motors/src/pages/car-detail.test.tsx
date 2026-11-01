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
  window.sessionStorage.clear();
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
  expect(document.querySelector('.vehicle-detail-grid .vehicle-key-facts')).toBeNull();
  expect(within(document.querySelector('.vehicle-detail-grid') as HTMLElement).getAllByText('90,000 miles', { exact: true })).toHaveLength(1);
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

it('offers printing through More vehicle tools', () => {
  renderVehicle('with-plate');
  fireEvent.click(screen.getByRole('button', { name: 'More vehicle tools' }));
  const link = screen.getByRole('button', { name: 'Print vehicle details for BMW 3 Series' });
  expect(link).toHaveAttribute('type', 'button');
  expect(link.closest('[data-popup-surface="popover"]')).not.toBeNull();
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

it('keeps service and part-exchange contact routes usable when online enquiries are disabled', () => {
  featureState.data.features.partExchange = true;
  renderVehicle('with-plate', { ...dealerConfig, partExchange: { ...dealerConfig.partExchange!, enabled: true } });
  expect(screen.getByRole('link', { name: 'Contact the showroom about service records' })).toHaveAttribute('href', '/contact');
  expect(screen.getByRole('link', { name: /Part exchange your car/ })).toHaveAttribute('href', '/contact');
  expect(screen.queryByRole('button', { name: 'Quick answers' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Request service records/ })).not.toBeInTheDocument();
  expect(screen.queryByTestId('form-enquiry')).not.toBeInTheDocument();
});

it('omits empty extra options while keeping sharing visible and printing in More', () => {
  window.history.pushState({}, '', '/vehicle/with-plate');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(getGetDealerSettingsQueryKey(), { ...dealerConfig, partExchange: { ...dealerConfig.partExchange, enabled: false }, onlineReservation: { enabled: false, depositPence: 10000, terms: '' }, presentation: { ...dealerConfig.presentation, comparisonEnabled: false } });
  render(<QueryClientProvider client={client}><SavedCarsProvider><CarDetail /></SavedCarsProvider></QueryClientProvider>);
  expect(screen.queryByTestId('vehicle-secondary-actions')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Share this vehicle' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'More vehicle tools' }));
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

it('hands a typed quick-answer question to the manual message form without losing an existing draft', async () => {
  featureState.data.features.publicEnquiries = true;
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  renderVehicle('with-plate');
  const disclosure = document.getElementById('vehicle-enquiry') as HTMLDetailsElement;
  expect(disclosure.open).toBe(false);
  fireEvent.click(screen.getByRole('link', { name: 'Message the showroom' }));
  const message = screen.getByTestId('textarea-enquiry-message');
  await waitFor(() => expect(disclosure.open).toBe(true));
  fireEvent.change(message, { target: { value: 'I would like to visit on Saturday.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Quick answers' }));
  const dialog = await screen.findByRole('dialog', { name: 'Quick answers' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: /^Search (?:these|all) answers$/ }), { target: { value: 'Can you measure the boot opening for me?' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Ask our team' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quick answers' })).not.toBeInTheDocument());
  await waitFor(() => expect(message).toHaveValue('I would like to visit on Saturday.\n\nCan you measure the boot opening for me?'));
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
  const selectTenthPhoto = () => fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
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
    expect(primaryActions().querySelector('[data-vehicle-contact="booking"]')).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=with-plate');
    expect(within(primaryActions()).getByRole('link', { name: 'Message the showroom' })).toHaveAttribute('href', '#vehicle-enquiry');
    selectTenthPhoto();
    expectUninterruptedGallery();
    expect((document.getElementById('vehicle-enquiry') as HTMLDetailsElement).open).toBe(false);
    fireEvent.click(within(primaryActions()).getByRole('link', { name: 'Message the showroom' }));
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
    expect(primaryActions().querySelector('[data-vehicle-contact="booking"]')).toBeNull();
    selectTenthPhoto();
    expectUninterruptedGallery();
    fireEvent.click(within(primaryActions()).getByRole('link', { name: 'Message the showroom' }));
    await waitFor(() => expect(screen.getByTestId('form-enquiry')).toBeVisible());
  });

  it('removes every online enquiry and photo-request handoff when features are disabled, including fullscreen', async () => {
    renderVehicle('with-plate', settings(''));
    selectTenthPhoto();
    expectUninterruptedGallery();
    expect(primaryActions().querySelector('[data-vehicle-contact="booking"]')).toBeNull();
    expect(screen.queryByTestId('form-enquiry')).not.toBeInTheDocument();
    expect(document.querySelector('.vehicle-photo-request')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quick answers' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Message the showroom' })).not.toBeInTheDocument();
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
    expect(document.querySelector('.vehicle-direct-contact a')).toHaveAttribute('href', 'tel:07388831790');
    expect(primaryActions().querySelector('[data-vehicle-contact="booking"]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Message the showroom' })).not.toBeInTheDocument();
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
    expect(primaryActions().querySelector('[data-vehicle-contact="booking"]')).toBeNull();
    expect(within(primaryActions()).getByRole('link', { name: 'Message the showroom' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quick answers' })).toBeInTheDocument();
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
  const early = within(document.querySelector('.vehicle-help-links') as HTMLElement).getByRole('button', { name: 'Delivery estimate' });
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
