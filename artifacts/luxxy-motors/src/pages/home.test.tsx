import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from '@/pages/home';
import { SavedCarsProvider } from '@/lib/saved-cars-context';

const { stockFixture, dealerConfigFixture, recentHandoversState, scrollToHomeTarget } = vi.hoisted(() => {
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
    scrollToHomeTarget: vi.fn(),
  };
});

let overrideSettings = dealerConfigFixture;

vi.mock('@/lib/dealer-settings-context', () => ({
  useDealerSettings: () => ({ settings: overrideSettings, isLoading: false, isError: false }),
}));

vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({ stock: stockFixture, isLoading: false, error: null }),
}));

vi.mock('@/lib/home-navigation', () => ({
  flushPendingHomeTarget: vi.fn(),
  scrollToHomeTarget,
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
  vi.clearAllMocks();
  window.localStorage.clear();
  overrideSettings = dealerConfigFixture;
  recentHandoversState.value = { schemaVersion: 1, handovers: [], isLoading: false, isError: false };
});

describe('showroom search filters', () => {
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

  it('lets shoppers move through the featured forecourt cars', () => {
    renderHome();

    const carousel = screen.getByTestId('featured-forecourt-carousel');
    expect(within(carousel).getByText(/30,000 miles/)).toBeInTheDocument();
    expect(within(carousel).getByText(/Automatic/)).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next featured car' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous featured car' }));
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
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
    expect(screen.getByTestId('compact-actions-bmw-1-series')).toHaveClass('grid-cols-1');
    expect(screen.getByTestId('compact-actions-bmw-1-series')).toHaveClass('sm:grid-cols-[1fr_auto]');
  });

  it('restores the saved stock display preference', () => {
    window.localStorage.setItem('luxxy.stock-view.v1', 'compact');
    renderHome();

    expect(screen.getByTestId('button-stock-view-compact')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('compact-vehicle-bmw-1-series')).toBeInTheDocument();
  });

  it('lets shoppers pause and resume the featured carousel', () => {
    renderHome();

    const pause = screen.getByRole('button', { name: 'Pause featured vehicles' });
    fireEvent.click(pause);
    expect(screen.getByRole('button', { name: 'Play featured vehicles' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Play featured vehicles' }));
    expect(screen.getByRole('button', { name: 'Pause featured vehicles' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('respects curated featured order and filters stale IDs without images', () => {
    // Both bmw-3-series and bmw-1-series have photos. ford-fiesta does not. unknown-id does not exist.
    overrideSettings = {
      ...dealerConfigFixture,
      featuredVehicleIds: ['unknown-id', 'bmw-3-series', 'ford-fiesta', 'bmw-1-series'],
    };
    renderHome();

    // Since 'bmw-3-series' and 'bmw-1-series' are the only valid photographed ones, 
    // it should only show 2 cars, and start with bmw-3-series.
    const carousel = screen.getByTestId('featured-forecourt-carousel');
    expect(within(carousel).getByText(/BMW 3 Series/)).toBeInTheDocument();
    
    // There are only 2 valid cars that made it through
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    
    // Check next car is bmw-1-series
    fireEvent.click(screen.getByRole('button', { name: 'Next featured car' }));
    expect(within(carousel).getByText(/BMW 1 Series/)).toBeInTheDocument();
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });

  it('falls back to stable stock order when no featured vehicles are valid', () => {
    // Only invalid IDs provided
    overrideSettings = {
      ...dealerConfigFixture,
      featuredVehicleIds: ['unknown-id', 'ford-fiesta'],
    };
    renderHome();

    // Should fall back to the 2 cars with photos, ordered exactly as they arrive from the mock feed ('bmw-1-series', then 'bmw-3-series')
    const carousel = screen.getByTestId('featured-forecourt-carousel');
    expect(within(carousel).getByText(/BMW 1 Series/)).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    
    fireEvent.click(screen.getByRole('button', { name: 'Next featured car' }));
    expect(within(carousel).getByText(/BMW 3 Series/)).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /Reset search/ })).toHaveTextContent('(2)');
  });

  it('sorts the live results and resets every shared filter value', () => {
    renderHome();

    fireEvent.change(screen.getByLabelText('Sort results'), {
      target: { value: 'price-asc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show results' }));
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
    fireEvent.click(screen.getByRole('button', { name: /Reset search/ }));

    expect(resultTitles()).toHaveLength(4);
    expect(resultsRegion().getByText('5 vehicles available')).toBeInTheDocument();
    expect((screen.getByTestId('input-showroom-search') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced search' }));
    expect((screen.getByLabelText('Make') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Sort results') as HTMLSelectElement).value).toBe('');
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('invokes the existing results-scroll callback when showing results', async () => {
    renderHome();

    fireEvent.click(screen.getByRole('button', { name: 'Show results' }));

    await waitFor(() => {
      expect(scrollToHomeTarget).toHaveBeenCalledWith('vehicle-results');
    });
  });
});