import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from '@/pages/home';
import { SavedCarsProvider } from '@/lib/saved-cars-context';

const { stockFixture, dealerConfigFixture, recentHandoversState, scrollToHomeTarget, focusHomeTarget } = vi.hoisted(() => {
  const baseCar = {
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

  const car = (overrides: Record<string, unknown>) => ({ ...baseCar, ...overrides });
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
    bookViewing: { title: 'Book a viewing', ctaLabel: 'Book now', description: 'Book a viewing' },
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

let overrideSettings: typeof dealerConfigFixture & {
  presentation?: { heroImageUrl?: string; heroImageAlt?: string; showroomImageUrl?: string; showroomImageAlt?: string };
} = dealerConfigFixture;

vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({ settings: overrideSettings, isLoading: false, isError: false }),
}));

vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({ stock: stockFixture, isLoading: false, error: null }),
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

function renderHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SavedCarsProvider>
        <Home />
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
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
  window.localStorage.clear();
  overrideSettings = dealerConfigFixture;
  recentHandoversState.value = { schemaVersion: 1, handovers: [], isLoading: false, isError: false };
});

describe('showroom search filters', () => {
  it('links Luxxy brand artwork to stock without attaching a vehicle price', () => {
    overrideSettings = { ...dealerConfigFixture, identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' } };
    renderHome();
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(hero).toHaveAttribute('href', '/#stock');
    expect(hero).toHaveTextContent('Explore our current stock');
    expect(hero).not.toHaveTextContent('£');
    expect(within(hero).getByRole('img')).toHaveAttribute('alt', expect.stringContaining('Illustrative Luxxy brand image'));
    const introduction = screen.getByRole('region', { name: 'Come and see for yourself.' });
    expect(within(introduction).getByRole('img')).toHaveAttribute('src', within(hero).getByRole('img').getAttribute('src'));
    expect(within(introduction).getByRole('img')).toHaveAttribute('alt', expect.stringContaining('Illustrative Luxxy brand image'));
  });

  it('keeps other dealerships on their own photographed stock', () => {
    renderHome();
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(hero).toHaveAttribute('href', '/vehicle/bmw-1-series');
    expect(within(hero).getByRole('img')).toHaveAttribute('src', 'https://cdn.example.com/bmw-1.jpg');
    expect(within(screen.getByRole('region', { name: 'Come and see for yourself.' })).getByRole('img')).toHaveAttribute('src', 'https://cdn.example.com/bmw-1.jpg');
  });

  it('lets explicit featured stock replace the bundled Luxxy artwork', () => {
    overrideSettings = { ...dealerConfigFixture, identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' }, featuredVehicleIds: ['bmw-3-series'] };
    renderHome();
    expect(screen.getByTestId('showroom-hero-photo')).toHaveAttribute('href', '/vehicle/bmw-3-series');
    expect(screen.getByTestId('showroom-hero-photo')).toHaveTextContent('£10,000');
  });

  it('respects a configured homepage image ahead of brand artwork and featured stock', () => {
    overrideSettings = {
      ...dealerConfigFixture,
      identity: { ...dealerConfigFixture.identity, name: 'Luxxy Motors' },
      featuredVehicleIds: ['bmw-3-series'],
      presentation: { heroImageUrl: 'https://example.com/showroom.jpg', heroImageAlt: 'Our dealership exterior' },
    };
    renderHome();
    const hero = screen.getByTestId('showroom-hero-photo');
    expect(hero).toHaveAttribute('href', '/#stock');
    expect(within(hero).getByRole('img')).toHaveAttribute('src', 'https://example.com/showroom.jpg');
    expect(within(hero).getByRole('img')).toHaveAttribute('alt', 'Our dealership exterior');
    expect(hero).not.toHaveTextContent('£');
  });

  it('keeps a configured introduction photo and dealer points instead of replacing them with defaults', () => {
    overrideSettings = {
      ...dealerConfigFixture,
      presentation: {
        heroImageUrl: 'https://example.com/hero.jpg',
        showroomImageUrl: 'https://example.com/team.jpg',
        showroomImageAlt: 'Our team outside the dealership',
      },
    };
    renderHome();
    const introduction = screen.getByRole('region', { name: 'Come and see for yourself.' });
    expect(within(introduction).getByRole('img')).toHaveAttribute('src', 'https://example.com/team.jpg');
    expect(within(introduction).getByRole('img')).toHaveAttribute('alt', 'Our team outside the dealership');
    expect(within(introduction).getByRole('heading', { name: 'How we work' })).toBeInTheDocument();
    expect(within(introduction).getByRole('link', { name: 'Arrange a viewing' })).toHaveAttribute('href', '/enquire?type=viewing');
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
    renderHome();

    const section = screen.getByTestId('recent-handovers-section');
    expect(within(section).getByRole('heading', { name: 'Recently handed over' })).toBeInTheDocument();
    expect(within(section).getByText('BMW 1 Series M Sport')).toBeInTheDocument();
    expect(within(section).getByText('August 2026')).toBeInTheDocument();
    expect(section.compareDocumentPosition(document.getElementById('about')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps recent handovers absent when the dealer disables them or none qualify', () => {
    renderHome();
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
    renderHome();
    expect(screen.queryByTestId('recent-handovers-section')).not.toBeInTheDocument();
  });

  it('keeps stock browsing available while handover data is loading or unavailable', () => {
    recentHandoversState.value = { schemaVersion: 1, handovers: [], isLoading: true, isError: false };
    renderHome();
    expect(screen.getByTestId('button-view-all-vehicles')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-handovers-section')).not.toBeInTheDocument();

    cleanup();
    recentHandoversState.value = { schemaVersion: 1, handovers: [], isLoading: false, isError: true };
    renderHome();
    expect(screen.getByTestId('button-view-all-vehicles')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-handovers-section')).not.toBeInTheDocument();
  });

  it('starts with a short welcome and puts stock search before any editorial sections', () => {
    renderHome();

    expect(screen.getByRole('heading', { name: /Find your next car/i })).toBeInTheDocument();
    expect(screen.getByTestId('input-showroom-search')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Latest arrivals' })).toBeInTheDocument();
    expect(screen.queryByTestId('featured-forecourt-carousel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('button-hero-primary')).not.toBeInTheDocument();
  });

  it('switches between full cards and the compact stock list', () => {
    renderHome();

    expect(screen.getByTestId('card-vehicle-bmw-1-series')).toBeInTheDocument();
    expect(screen.getByTestId('button-stock-view-cards')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('button-stock-view-compact'));

    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
    expect(screen.getByTestId('button-stock-view-compact')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('card-vehicle-bmw-1-series')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('luxxy.stock-view.v1')).toBe('compact');
    expect(screen.getByTestId('button-compare-bmw-1-series')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /view/i }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('compact-actions-bmw-1-series')).toHaveClass('flex-wrap');
    expect(screen.getByTestId('compact-actions-bmw-1-series')).toHaveClass('justify-between');
  });

  it('restores the saved stock display preference', () => {
    window.localStorage.setItem('luxxy.stock-view.v1', 'compact');
    renderHome();

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
    fireEvent.click(screen.getByRole('button', { name: 'View matching cars' }));
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
    expect(screen.getByText(/repaired structural damage/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Category S' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Category N' }));

    expect(resultTitles()).toEqual(['BMW 3 Series', 'Ford Fiesta']);
    expect(screen.getByRole('button', { name: 'Advanced search' })).toHaveTextContent('(2)');
  });

  it('sorts the live results and resets every shared filter value', () => {
    renderHome();

    fireEvent.change(screen.getByLabelText('Sort results'), {
      target: { value: 'price-asc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'View matching cars' }));
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
    fireEvent.click(screen.getByRole('button', { name: /Reset/i }));

    expect(resultTitles()).toHaveLength(3);
    expect(screen.getByText('5 vehicles available')).toBeInTheDocument();
    expect((screen.getByTestId('input-showroom-search') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect((screen.getByLabelText('Make') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Sort results') as HTMLSelectElement).value).toBe('');
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('invokes the existing results-scroll callback when viewing matching cars', async () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'View matching cars' }));

    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
      expect(focusHomeTarget).toHaveBeenCalledWith('vehicle-results-heading');
    });
  });

  it('reveals all results and scrolls when clicking View All Vehicles', async () => {
    renderHome();
    expect(resultTitles()).toHaveLength(3); // latest arrivals shows one desktop row
    fireEvent.click(screen.getByTestId('button-view-all-vehicles'));
    expect(resultTitles()).toHaveLength(5);
    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
      expect(focusHomeTarget).toHaveBeenCalledWith('vehicle-results-heading');
    });
  });

  it.each([
    ['Automatic', 'button-quick-automatic'],
    ['Under £5k', 'button-quick-under-5000'],
    ['Low miles', 'button-quick-low-mileage'],
  ])('moves focus to results after activating the %s quick filter', async (_label, testId) => {
    renderHome();

    fireEvent.click(screen.getByTestId(testId));

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
