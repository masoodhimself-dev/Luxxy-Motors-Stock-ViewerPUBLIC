import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from '@/pages/home';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import type { Car } from '@/lib/stock-context';

const { stockFixture, dealerConfigFixture, recentHandoversState, scrollToHomeTarget, focusHomeTarget } = vi.hoisted(() => {
  const baseCar: Car = {
    id: '',
    advertId: '',
    title: '',
    variant: null,
    make: '',
    model: '',
    trim: null,
    year: 2022,
    price: null,
    priceType: 'fixed',
    currency: 'GBP',
    mileage: null,
    mileageText: null,
    registration: null,
    registrationBand: null,
    plate: null,
    vrm: null,
    vrmVerified: null,
    fuel: null,
    transmission: null,
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

  const car = (overrides: Partial<Car>) => ({ ...baseCar, ...overrides });
  const cars = [
    car({
      id: 'bmw-1-series',
      advertId: 'bmw-1-series',
      title: 'BMW 1 Series',
      make: 'BMW',
      model: '1 Series',
      price: 5000,
      mileage: 30000,
      fuel: 'Petrol',
      transmission: 'Automatic',
      registration: 'AB12 BMW',
      heroImage: 'https://cdn.example.com/bmw-1.jpg',
    }),
    car({
      id: 'bmw-3-series',
      advertId: 'bmw-3-series',
      title: 'BMW 3 Series',
      make: 'BMW',
      model: '3 Series',
      price: 10000,
      mileage: 10000,
      fuel: 'Diesel',
      transmission: 'Manual',
      writeOffCategory: 'CAT S',
      heroImage: 'https://cdn.example.com/bmw-3.jpg',
    }),
    car({
      id: 'ford-fiesta',
      advertId: 'ford-fiesta',
      title: 'Ford Fiesta',
      make: 'Ford',
      model: 'Fiesta',
      price: 7500,
      mileage: 50000,
      fuel: 'Petrol',
      transmission: 'Manual',
      writeOffCategory: 'CAT N',
    }),
    car({
      id: 'audi-a3',
      advertId: 'audi-a3',
      title: 'Audi A3',
      make: 'Audi',
      model: 'A3',
      price: 5000,
      mileage: 20000,
      fuel: 'Hybrid',
      transmission: 'Automatic',
    }),
    car({
      id: 'vw-golf',
      advertId: 'vw-golf',
      title: 'VW Golf',
      make: 'Volkswagen',
      model: 'Golf',
      price: 4999,
      mileage: 40000,
      fuel: 'Petrol',
      transmission: 'Automatic',
    }),
  ];

  const dealerConfigBase = {
    identity: { name: 'Test Motors', brandColors: { primaryHsl: '0 0 0', accentHsl: '0 0 0' } },
    contact: { phone: '01234567890' },
    address: { city: 'Test City', region: 'Test Region' },
    hero: { copy: 'Find your next car', subcopy: 'Subcopy', announcement: 'Test Announcement', primaryCta: 'See stock', secondaryCta: 'Part exchange' },
    bookViewing: { title: 'Book a Test Drive', ctaLabel: 'Book now', description: 'Book a Test Drive' },
    trustItems: ['Trust point 1'],
    whyBuy: [{ title: 'How we work', description: 'A clear buying process.' }],
    featuredVehicleIds: [] as string[],
    recentHandovers: { enabled: true, count: 3 },
    delivery: { enabled: true, title: 'Delivery', description: 'Delivery available', ctaLabel: 'Delivery enquiry' },
    warranty: { enabled: true, title: 'Warranty', description: 'Warranty available', ctaLabel: 'Warranty enquiry' },
    partExchange: { enabled: true, title: 'Part exchange', description: 'Part exchange available', ctaLabel: 'Part exchange enquiry' },
  };

  return {
    stockFixture: {
      schemaVersion: 1,
      dealerName: 'Test Motors',
      dealerLocation: 'Test Town',
      count: cars.length,
      scrapedAt: null,
      cars,
    },
    dealerConfigFixture: dealerConfigBase,
    recentHandoversState: {
      value: {
        schemaVersion: 1,
        handovers: [] as Array<{
          vehicle: { make: string | null; model: string | null; trim: string | null; year: number | null; bodyType: string | null; fuel: string | null; transmission: string | null };
          handoverMonth: string;
        }>,
        isLoading: false,
        isError: false,
      },
    },
    scrollToHomeTarget: vi.fn(() => true),
    focusHomeTarget: vi.fn(),
  };
});

let stockIsLoading = false;
let demoSiteMode = false;
vi.mock('@/lib/demo-status',()=>({useDemoStatus:()=>demoSiteMode}));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => true }) }));

let overrideSettings: typeof dealerConfigFixture & {
  presentation?: { websiteCopy?: { stockIntroduction?: string }; heroImageUrl?: string; heroImageAlt?: string; showroomImageUrl?: string; showroomImageAlt?: string };
} = dealerConfigFixture;

vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({ settings: overrideSettings, isLoading: false, isError: false }),
}));

vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({ stock: stockFixture, isLoading: stockIsLoading, error: null }),
}));

vi.mock('@/lib/home-navigation', () => ({
  flushPendingHomeTarget: vi.fn(),
  hasPendingHomeTarget: () => false,
  scrollToHomeTarget,
  focusHomeTarget,
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetRecentHandovers: () => ({ data: recentHandoversState.value, isLoading: recentHandoversState.value.isLoading, isError: recentHandoversState.value.isError }),
  getGetRecentHandoversQueryKey: () => ['/api/recent-handovers'],
}));

function renderHome(browseStock = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SavedCarsProvider>
        <Home browseStock={browseStock} />
      </SavedCarsProvider>
    </QueryClientProvider>,
  );
}

function resultsRegion() {
  const region = document.getElementById('vehicle-results');
  if (!region) throw new Error('Vehicle results section was not rendered');
  return within(region);
}

function resultTitles() {
  return resultsRegion()
    .getAllByRole('heading', { level: 3, hidden: true })
    .map((heading) => heading.textContent);
}

const originalCars = stockFixture.cars.map((car) => ({ ...car }));

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  stockIsLoading=false;
  demoSiteMode=false;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  window.history.replaceState({}, '', '/');
  window.sessionStorage.clear();
  vi.clearAllMocks();
  window.localStorage.clear();
  overrideSettings = dealerConfigFixture;
  recentHandoversState.value = { schemaVersion: 1, handovers: [], isLoading: false, isError: false };
  stockFixture.cars = originalCars.map((car) => ({ ...car }));
});

describe('showroom data resilience', () => {
  it('keeps browsing and view controls usable when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'QuotaExceededError'); });
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));
    expect(screen.getByTestId('card-vehicle-bmw-1-series')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('button-stock-view-compact'));
    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
  });

  it.each(['price-asc', 'price-desc', 'mileage-asc', 'mileage-desc'])('puts missing values last for %s', (sort) => {
    stockFixture.cars = [
      { ...originalCars[0], price: null, mileage: null },
      { ...originalCars[1], price: 10000, mileage: 20000 },
      { ...originalCars[2], price: 5000, mileage: 0 },
    ];
    renderHome();
    fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: sort } });
    expect(resultTitles()).toEqual(sort.endsWith('asc')
      ? ['Ford Fiesta', 'BMW 3 Series', 'BMW 1 Series']
      : ['BMW 3 Series', 'Ford Fiesta', 'BMW 1 Series']);
  });

  it('normalises pasted search whitespace and finds compact plates and VRMs', () => {
    stockFixture.cars[0] = { ...originalCars[0], registration: null, plate: null, vrm: 'AB12 BMW' };
    renderHome();
    fireEvent.change(screen.getByTestId('input-showroom-search'), { target: { value: '  ab12bmw  ' } });
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    fireEvent.change(screen.getByTestId('input-showroom-search'), { target: { value: '  fiesta  ' } });
    expect(resultTitles()).toEqual(['Ford Fiesta']);
  });

  it('does not include unknown insurance history in the clear-history filter', () => {
    stockFixture.cars[0] = { ...originalCars[0], writeOffCategory: 'None' };
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'No recorded write-off' }));
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'No recorded write-off' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Category N' }));
    expect(resultTitles()).toEqual(['Ford Fiesta']);
  });
});

describe('showroom search filters', () => {
  it('uses Luxxy brand artwork behind search without attaching a vehicle price', () => {
    overrideSettings = { ...dealerConfigFixture, identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' } };
    renderHome(false);
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(hero.textContent).toBe('');
    expect(hero).not.toHaveTextContent('£');
    expect(within(hero).getByRole('img')).toHaveAttribute('alt', expect.stringContaining('Illustrative Luxxy brand image'));
    const introduction = screen.getByRole('region', { name: 'Plan your visit' });
    expect(within(introduction).queryByRole('img')).not.toBeInTheDocument();
    expect(introduction).toHaveTextContent('Test City');
  });

  it('keeps other dealerships on their own photographed stock', () => {
    renderHome(false);
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(hero).not.toHaveTextContent('BMW 1 Series');
    expect(hero).not.toHaveTextContent('£');
    expect(within(hero).getByRole('img')).toHaveAttribute('src', 'https://cdn.example.com/bmw-1.jpg');
    expect(within(screen.getByRole('region', { name: 'Plan your visit' })).queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps the bundled Luxxy artwork independent of featured stock', () => {
    overrideSettings = { ...dealerConfigFixture, identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' }, featuredVehicleIds: ['bmw-3-series'] };
    renderHome(false);
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(within(hero).getByRole('img')).toHaveAttribute('src', expect.stringContaining('luxxy-hero.jpg'));
    expect(hero).not.toHaveTextContent('BMW');
    expect(hero).not.toHaveTextContent('£');
  });

  it('respects a configured homepage image ahead of brand artwork and featured stock', () => {
    overrideSettings = {
      ...dealerConfigFixture,
      identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' },
      featuredVehicleIds: ['bmw-3-series'],
      presentation: { heroImageUrl: 'https://example.com/showroom.jpg', heroImageAlt: 'Our dealership exterior' },
    };
    renderHome(false);
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(within(hero).getByRole('img')).toHaveAttribute('src', 'https://example.com/showroom.jpg');
    expect(within(hero).getByRole('img')).toHaveAttribute('alt', 'Our dealership exterior');
    expect(hero).not.toHaveTextContent('£');
  });

  it('keeps the dealer points and booking link while replacing the introduction photo with visit information', () => {
    overrideSettings = {
      ...dealerConfigFixture,
      presentation: {
        heroImageUrl: 'https://example.com/hero.jpg',
        showroomImageUrl: 'https://example.com/team.jpg',
        showroomImageAlt: 'Our team outside the dealership',
      },
    };
    renderHome(false);
    const introduction = screen.getByRole('region', { name: 'Plan your visit' });
    expect(within(introduction).queryByRole('img')).not.toBeInTheDocument();
    expect(introduction).toHaveTextContent('Test City');
    expect(screen.getByRole('heading', { name: 'How we work' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Why choose us?' })).toBeInTheDocument();
    expect(within(introduction).getByRole('link', { name: dealerConfigFixture.bookViewing.ctaLabel })).toHaveAttribute('href', '/enquire?type=viewing');
  });

  it('shows anonymised recent handovers before the how-we-work section', () => {
    recentHandoversState.value = {
      schemaVersion: 1,
      handovers: [
        {
          vehicle: { make: 'BMW', model: '1 Series', trim: 'M Sport', year: 2022, bodyType: 'Hatchback', fuel: 'Petrol', transmission: 'Automatic' },
          handoverMonth: 'August 2026',
        },
      ],
      isLoading: false,
      isError: false,
    };
    renderHome(false);

    const section = screen.getByTestId('recent-handovers-section');
    expect(within(section).getByRole('heading', { name: 'Recently handed over' })).toBeInTheDocument();
    expect(within(section).getByText('BMW 1 Series M Sport')).toBeInTheDocument();
    expect(within(section).getByText('August 2026')).toBeInTheDocument();
    expect(section.compareDocumentPosition(document.getElementById('about')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps recent handovers absent when the dealer disables them or none qualify', () => {
    renderHome(false);
    expect(screen.queryByTestId('recent-handovers-section')).not.toBeInTheDocument();

    recentHandoversState.value = {
      schemaVersion: 1,
      handovers: [
        {
          vehicle: { make: 'Audi', model: 'A3', trim: null, year: 2021, bodyType: 'Hatchback', fuel: 'Hybrid', transmission: 'Automatic' },
          handoverMonth: 'July 2026',
        },
      ],
      isLoading: false,
      isError: false,
    };
    overrideSettings = { ...dealerConfigFixture, recentHandovers: { enabled: false, count: 3 } };
    renderHome(false);
    expect(screen.queryByTestId('recent-handovers-section')).not.toBeInTheDocument();
  });

  it('keeps stock browsing available while handover data is loading or unavailable', () => {
    recentHandoversState.value = { schemaVersion: 1, handovers: [], isLoading: true, isError: false };
    renderHome();
    expect(screen.getByRole('heading', {name: 'Browse Stock'})).toBeInTheDocument();
    expect(screen.queryByTestId('recent-handovers-section')).not.toBeInTheDocument();

    cleanup();
    recentHandoversState.value = { schemaVersion: 1, handovers: [], isLoading: false, isError: true };
    renderHome();
    expect(screen.getByRole('heading', {name: 'Browse Stock'})).toBeInTheDocument();
    expect(screen.queryByTestId('recent-handovers-section')).not.toBeInTheDocument();
  });

  it('keeps the homepage carousel separate from stock filters', () => {
    renderHome(false);
    expect(screen.getByRole('heading', { name: /Find your next car/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Explore our cars' })).toBeInTheDocument();
    expect(screen.queryByTestId('input-showroom-search')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse Stock' })).toHaveAttribute('href', '/stock');
    expect(screen.queryByRole('button', { name: 'Auto-scroll cars' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next featured cars' })).toBeInTheDocument();
    expect(screen.getAllByTestId(/^card-vehicle-/)).toHaveLength(originalCars.length);
  });

  it('switches between full cards and the compact stock list', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));

    expect(screen.getByTestId('card-vehicle-bmw-1-series')).toBeInTheDocument();
    expect(screen.getByTestId('button-stock-view-cards')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('button-stock-view-compact'));

    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
    expect(screen.getByTestId('button-stock-view-compact')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('card-vehicle-bmw-1-series')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('luxxy.stock-view.v1')).toBe('compact');
    expect(screen.queryByTestId('button-compare-bmw-1-series')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /view/i }).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('compact-actions-bmw-1-series')).not.toBeInTheDocument();
  });

  it('restores the saved stock display preference', () => {
    window.localStorage.setItem('luxxy.stock-view.v1', 'compact');
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'View options' }));

    expect(screen.getByTestId('button-stock-view-compact')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
  });

  it('filters by text and limits model choices to the selected make', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));

    const make = screen.getByLabelText('Make') as HTMLSelectElement;
    const model = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(model).toBeDisabled();

    fireEvent.change(make, { target: { value: 'BMW' } });

    expect(model).not.toBeDisabled();
    expect(within(model).getByRole('option', { name: '1 Series' })).toBeInTheDocument();
    expect(within(model).getByRole('option', { name: '3 Series' })).toBeInTheDocument();
    expect(within(model).queryByRole('option', { name: 'Fiesta' })).not.toBeInTheDocument();

    fireEvent.change(model, { target: { value: '1 Series' } });
    expect(resultTitles()).toEqual(['BMW 1 Series']);

    fireEvent.change(screen.getByTestId('input-showroom-search'), {
      target: { value: 'AB12 BMW' },
    });
    expect(resultTitles()).toEqual(['BMW 1 Series']);
  });

  it('includes exact min and max budget boundaries and filters fuel and transmission', () => {
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));

    fireEvent.change(screen.getByLabelText('Min budget'), {
      target: { value: '5000' },
    });
    fireEvent.keyDown(screen.getByTestId('input-showroom-search'), { key: 'Enter' });
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series', 'Ford Fiesta', 'Audi A3']);

    fireEvent.change(screen.getByLabelText('Min budget'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Max budget'), {
      target: { value: '5000' },
    });
    expect(resultTitles()).toEqual(['BMW 1 Series', 'Audi A3', 'VW Golf']);

    fireEvent.change(screen.getByLabelText('Max budget'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Fuel'), { target: { value: 'Diesel' } });
    expect(resultTitles()).toEqual(['BMW 3 Series']);

    fireEvent.change(screen.getByLabelText('Fuel'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Transmission'), {
      target: { value: 'Manual' },
    });
    expect(resultTitles()).toEqual(['BMW 3 Series', 'Ford Fiesta']);
  });

  it('exposes explained insurance-history filters and counts each active choice', () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.getByText(/Category S records structural damage/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Category S' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Category N' }));

    expect(resultTitles()).toEqual(['BMW 3 Series', 'Ford Fiesta']);
    expect(screen.getByRole('button', { name: 'Advanced search', hidden: true })).toHaveTextContent('(2)');
  });

  it('sorts the live results and resets every shared filter value', () => {
    renderHome();

    fireEvent.change(screen.getByLabelText('Sort results'), {
      target: { value: 'price-asc' },
    });
    fireEvent.keyDown(screen.getByTestId('input-showroom-search'), { key: 'Enter' });
    expect(resultTitles()).toEqual([
      'VW Golf',
      'BMW 1 Series',
      'Audi A3',
      'Ford Fiesta',
      'BMW 3 Series',
    ]);

    fireEvent.change(screen.getByTestId('input-showroom-search'), {
      target: { value: 'BMW' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Reset all/i }));

    expect(resultTitles()).toHaveLength(5);
    expect(screen.getByText('5 cars in stock')).toBeInTheDocument();
    expect((screen.getByTestId('input-showroom-search') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect((screen.getByLabelText('Make') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Sort results') as HTMLSelectElement).value).toBe('');
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('invokes the existing results-scroll callback when viewing matching cars', async () => {
    renderHome();

    fireEvent.keyDown(screen.getByTestId('input-showroom-search'), { key: 'Enter' });

    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
      expect(focusHomeTarget).toHaveBeenCalledWith('vehicle-results-heading');
    });
  });

  it('shows the full stock without a second reveal action', () => {
    renderHome();
    expect(resultTitles()).toHaveLength(5);
    expect(screen.queryByTestId('button-view-all-vehicles')).not.toBeInTheDocument();
  });

  it.each([
    ['Automatic', 'button-quick-automatic'],
    ['Under £5k', 'button-quick-under-5000'],
    ['Low miles', 'button-quick-low-mileage'],
  ])('keeps the panel open for the %s quick choice and moves to results only after Show cars', async (_label, testId) => {
    renderHome();

    fireEvent.click(screen.getByRole("button", {name:"Advanced search"}));
    fireEvent.click(screen.getByTestId(testId));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(scrollToHomeTarget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Show \d+ cars?$/ }));

    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
      expect(focusHomeTarget).toHaveBeenCalledWith('vehicle-results-heading');
    });
  });

  it('reveals all results and scrolls when pressing Enter in the search box', async () => {
    renderHome();
    const searchInput = screen.getByTestId('input-showroom-search');
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });
    expect(resultTitles()).toHaveLength(5); // assuming it also reveals all
    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
    });
  });
});

it('loads cars in batches and excludes sold stock while keeping reserved cars last', () => {
  stockFixture.cars = Array.from({length: 15}, (_,i) => ({...originalCars[0], id: `batch-${i}`, title:`Batch car ${i}`, inventoryStatus:i === 0 ? 'reserved' : i === 1 ? 'sold' : 'available'}));
  stockFixture.count = 15;
  renderHome();
  expect(resultTitles()).toHaveLength(12);
  expect(screen.getByText('Showing 12 of 14 cars')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Show more cars'}));
  expect(resultTitles()).toHaveLength(14);
  expect(resultTitles().at(-1)).toBe('Batch car 0');
  expect(resultTitles()).not.toContain('Batch car 1');
});

describe('supplied vehicle benefit searches', () => {
  const runningCosts = (annualTax: string, insuranceGroup: string) => ({
    runningCosts: { items: [
      { key: 'Tax', label: 'Tax per year', value: annualTax },
      { key: 'Insurance', label: 'Insurance group', value: insuranceGroup },
    ] },
  });

  it('really filters to 30,000 miles or less, rather than just sorting all cars', () => {
    stockFixture.cars = [
      { ...originalCars[0], mileage: 30000 },
      { ...originalCars[1], mileage: 30001 },
      { ...originalCars[2], mileage: null },
      { ...originalCars[3], mileage: 0 },
    ];
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.getByTestId('button-quick-low-mileage')).toHaveTextContent('Up to 30,000 miles (2)');
    fireEvent.click(screen.getByTestId('button-quick-low-mileage'));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'Audi A3']);
    expect(window.location.search).toBe('?lowMileage=true');
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 cars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Up to 30,000 miles filter' }));
    expect(resultTitles()).toHaveLength(4);
    expect(window.location.search).toBe('');
  });

  it('uses supplied fuel and emission standards independently from mileage', () => {
    stockFixture.cars = [
      { ...originalCars[0], fuel: 'Petrol', emissionClass: 'Euro 4', mileage: 30001 },
      { ...originalCars[1], fuel: 'Diesel', emissionClass: 'Euro 6', mileage: 80000 },
      { ...originalCars[2], fuel: 'Diesel', emissionClass: 'Euro 5', mileage: 10000 },
      { ...originalCars[3], fuel: null, emissionClass: 'Euro 6', mileage: 10000 },
    ];
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    const choice = screen.getByTestId('button-quick-ulez');
    expect(choice).toHaveTextContent('ULEZ compliant (2)');
    expect(choice).toHaveAttribute('title', expect.stringContaining('supplied specifications'));
    fireEvent.click(choice);
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series']);
    expect(window.location.search).toBe('?ulez=true');
  });

  it('combines explicit advertised annual tax and insurance ranges without guessing missing values', () => {
    stockFixture.cars = [
      { ...originalCars[0], sourceExtras: runningCosts('£35', '15E') },
      { ...originalCars[1], sourceExtras: runningCosts('£0', '1A') },
      { ...originalCars[2], sourceExtras: runningCosts('£36', '8E') },
      { ...originalCars[3], sourceExtras: runningCosts('£20', '16E') },
      { ...originalCars[4], sourceExtras: null },
    ];
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.getByTestId('button-quick-lowAnnualTax')).toHaveTextContent('Road tax up to £35/year (3)');
    fireEvent.click(screen.getByTestId('button-quick-lowAnnualTax'));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series', 'Audi A3']);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('button-quick-lowInsuranceGroup')).toHaveTextContent('Insurance groups 1–15 (2)');
    fireEvent.click(screen.getByTestId('button-quick-lowInsuranceGroup'));
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series']);
    expect(window.location.search).toBe('?lowAnnualTax=true&lowInsuranceGroup=true');
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 cars' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(resultTitles()).toHaveLength(5);
    expect(window.location.search).toBe('');
  });

  it('keeps existing make and budget selections when a benefit is added', () => {
    renderHome();
    fireEvent.change(screen.getByLabelText('Quick filter by make'), { target: { value: 'BMW' } });
    fireEvent.change(screen.getByLabelText('Quick filter by maximum price'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.getByTestId('button-quick-low-mileage')).toHaveTextContent('Up to 30,000 miles (1)');
    fireEvent.click(screen.getByTestId('button-quick-low-mileage'));
    expect(resultTitles()).toEqual(['BMW 1 Series']);
    expect(window.location.search).toBe('?make=BMW&maxPrice=5000&lowMileage=true');
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 car' }));
    expect(screen.getByRole('button', { name: 'Advanced search' })).toHaveTextContent('(3)');
  });

  it('updates benefit counts for free-text search and restores them after reset', () => {
    renderHome();
    fireEvent.change(screen.getByTestId('input-showroom-search'), { target: { value: '  3 Series  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.getByTestId('button-quick-low-mileage')).toHaveTextContent('Up to 30,000 miles (1)');
    fireEvent.click(screen.getByTestId('button-quick-low-mileage'));
    expect(resultTitles()).toEqual(['BMW 3 Series']);
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 car' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.getByTestId('button-quick-low-mileage')).toHaveTextContent('Up to 30,000 miles (3)');
  });

  it('omits unavailable benefit choices and excludes sold vehicles from their counts', () => {
    stockFixture.cars = [
      { ...originalCars[0], mileage: 90000 },
      { ...originalCars[1], mileage: 12000, fuel: 'Diesel', emissionClass: 'Euro 6', sourceExtras: runningCosts('£20', '8E'), inventoryStatus: 'sold' },
    ];
    renderHome();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    for (const testId of ['button-quick-low-mileage', 'button-quick-ulez', 'button-quick-lowAnnualTax', 'button-quick-lowInsuranceGroup']) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  });

  it('restores shared benefit searches, supports empty results, and removes only the selected condition', () => {
    window.history.replaceState({}, '', '/stock?make=Ford&lowMileage=true&ulez=true');
    renderHome();
    expect(screen.getByRole('heading', { name: 'No matches' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect(screen.getByTestId('button-quick-low-mileage')).toHaveTextContent('Up to 30,000 miles (0)');
    expect(screen.getByTestId('button-quick-ulez')).toHaveTextContent('ULEZ compliant (0)');
    fireEvent.click(screen.getByRole('button', { name: /^Close$/ }));
    expect(screen.getByRole('button', { name: 'Remove ULEZ compliant filter' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove ULEZ compliant filter' }));
    expect(window.location.search).toBe('?make=Ford&lowMileage=true');
    fireEvent.click(screen.getByTestId('button-clear-filters'));
    expect(resultTitles()).toHaveLength(5);
    expect(window.location.search).toBe('');
  });

  it('keeps older saved filter sessions usable when they have no benefit fields', () => {
    window.sessionStorage.setItem('luxxy.browse.v1', JSON.stringify({ filters: {
      make: 'BMW', model: '', minPrice: '', maxPrice: '', fuel: '', transmission: '', search: '', catS: false, catN: false, noWriteOff: false, sort: '',
    } }));
    renderHome();
    expect(resultTitles()).toEqual(['BMW 1 Series', 'BMW 3 Series']);
    expect(window.location.search).toBe('?make=BMW');
  });
});

it("uses an illustrative car hero for demos and avoids a repeated demo announcement",()=>{demoSiteMode=true;overrideSettings={...dealerConfigFixture,hero:{...dealerConfigFixture.hero,announcement:"Demonstration website — sample activity, no real payments."}};renderHome(false);expect(screen.getByAltText("Illustrative stock photograph of a white BMW coupe")).toBeInTheDocument();expect(screen.queryByText("Demonstration website — sample activity, no real payments.")).not.toBeInTheDocument();});

it('refines the selected make and sort when a quick budget filter is applied', () => {
  renderHome();
  fireEvent.change(screen.getByLabelText('Quick filter by make'), { target: { value: 'BMW' } });
  fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'price-desc' } });
  fireEvent.click(screen.getByRole('button', { name: 'Show cars under £10k' }));
  expect(resultTitles()).toEqual(['BMW 3 Series', 'BMW 1 Series']);
  expect(window.location.search).toBe('?make=BMW&maxPrice=10000&sort=price-desc');
  fireEvent.click(screen.getByRole('button', { name: 'Show cars under £10k' }));
  expect(window.location.search).toBe('?make=BMW&sort=price-desc');
});

it('honours an explicit price sort including reserved cars', () => {
  stockFixture.cars = [
    { ...originalCars[0], price: 1000, inventoryStatus: 'reserved' },
    { ...originalCars[1], price: 10000 },
    { ...originalCars[2], price: 7500 },
  ];
  renderHome();
  expect(resultTitles()).toEqual(['BMW 3 Series', 'Ford Fiesta', 'BMW 1 Series']);
  fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'price-asc' } });
  expect(resultTitles()).toEqual(['BMW 1 Series', 'Ford Fiesta', 'BMW 3 Series']);
});

it('shows the dealership introduction before the stock request finishes', () => {
  stockIsLoading = true;
  renderHome(false);
  expect(screen.getByRole('heading', { name: 'Find your next car' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Loading cars…' })).toBeDisabled();
  expect(screen.getByText('Loading cars…', { selector: 'p' })).toHaveAttribute('role', 'status');
});

it('retains supplied equipment when mileage is the only omitted card highlight', () => {
  stockFixture.cars = [{ ...originalCars[0], mileage: 12885, fuel: null, emissionClass: null, sourceExtras: { features: ['Heated seats'] } }];
  renderHome();
  const card = screen.getByTestId('card-vehicle-bmw-1-series');
  expect(card).toHaveTextContent('12.9k miles');
  expect(card).toHaveTextContent('Heated seats');
  expect(card).not.toHaveTextContent('low mileage');
});

it('counts stock benefits within the selected make, model and budget together', () => {
  stockFixture.cars = [
    { ...originalCars[0], id:'match', make:'Toyota', model:'Yaris', title:'Toyota Yaris', price:4500, mileage:22000 },
    { ...originalCars[1], id:'over-budget', make:'Toyota', model:'Yaris', title:'Toyota Yaris', price:7500, mileage:18000 },
    { ...originalCars[2], id:'other-model', make:'Toyota', model:'Auris', title:'Toyota Auris', price:4000, mileage:12000 },
  ];
  renderHome();
  fireEvent.change(screen.getByLabelText('Quick filter by make'), {target:{value:'Toyota'}});
  fireEvent.change(screen.getByLabelText('Quick filter by model'), {target:{value:'Yaris'}});
  fireEvent.change(screen.getByLabelText('Quick filter by maximum price'), {target:{value:'5000'}});
  fireEvent.click(screen.getByRole('button',{name:'Advanced search'}));
  expect(screen.getByTestId('button-quick-low-mileage')).toHaveTextContent('Up to 30,000 miles (1)');
  expect(resultTitles()).toEqual(['Toyota Yaris']);
});


describe('compact customer stock presentation', () => {
  it('keeps the result count by the title and preserves a bespoke stock introduction', () => {
    renderHome();
    expect(document.querySelector('.stock-title-group')).toContainElement(screen.getByTestId('text-filtered-stock-count'));
    expect(screen.queryByText('Find your next used car.')).not.toBeInTheDocument();
    cleanup();
    overrideSettings = { ...dealerConfigFixture, presentation: { websiteCopy: { stockIntroduction: 'Browse our hand-picked stock.' } } } as typeof overrideSettings;
    renderHome();
    expect(screen.getByText('Browse our hand-picked stock.')).toBeInTheDocument();
  });

  it('puts core specifications before optional benefit badges and includes fuel in featured summaries', () => {
    stockFixture.cars = [{ ...originalCars[0], emissionClass: 'Euro 6' }];
    renderHome();
    const card = screen.getByTestId('card-vehicle-bmw-1-series');
    const specs = card.querySelector('.vehicle-specs')!;
    const benefits = card.querySelector('.vehicle-benefit-summary')!;
    expect(specs.compareDocumentPosition(benefits) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(specs).toHaveTextContent('Petrol');
    cleanup();
    renderHome(false);
    expect(screen.getByText('2022 · 30k miles · Petrol · Automatic')).toBeInTheDocument();
  });

  it('combines quick choices, budget and fuel without reopening the filter panel', async () => {
    renderHome();
    expect(screen.getByLabelText('Search the showroom')).toHaveAccessibleDescription('Try “automatic under £10k” or a registration.');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    fireEvent.click(screen.getByTestId('button-quick-automatic'));
    fireEvent.click(screen.getByTestId('button-quick-under-5000'));
    fireEvent.change(screen.getByLabelText('Fuel'), { target: { value: 'Petrol' } });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('button-quick-automatic')).toHaveAttribute('aria-pressed', 'true');
    expect(resultTitles()).toEqual(['BMW 1 Series', 'VW Golf']);
    expect(scrollToHomeTarget).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 cars' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.search).toBe('?maxPrice=5000&fuel=Petrol&transmission=Automatic');
    expect(screen.getByLabelText('Sort results')).toBeInTheDocument();
  });
});


it('shows a supplied structured insurance category in stock without inferring it from prose', () => {
  stockFixture.cars = [
    { ...originalCars[0], writeOffCategory: null, sourceExtras: { writeOffCategory: 'Category S' } },
    { ...originalCars[1], writeOffCategory: 'Unknown', sourceExtras: { writeOffCategory: 'Category S', description: 'The seller mentions Cat N.' } },
  ];
  renderHome();
  expect(within(screen.getByTestId('card-vehicle-bmw-1-series')).getByText('Category S recorded')).toBeInTheDocument();
  expect(within(screen.getByTestId('card-vehicle-bmw-3-series')).queryByText(/Category N recorded/)).not.toBeInTheDocument();
  expect(within(screen.getByTestId('card-vehicle-bmw-3-series')).queryByText(/Category S recorded/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Category S' }));
  expect(resultTitles()).toEqual(['BMW 1 Series']);
});
