import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from '@/pages/home';
import { SavedCarsProvider } from '@/lib/saved-cars-context';

const { stockFixture, scrollToHomeTarget } = vi.hoisted(() => {
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

  return {
    stockFixture: {
      schemaVersion: 1,
      dealerName: 'Test Motors',
      dealerLocation: 'Test Town',
      count: cars.length,
      scrapedAt: null,
      cars,
    },
    scrollToHomeTarget: vi.fn(),
  };
});

vi.mock('@/lib/stock-context', () => ({
  useStock: () => ({ stock: stockFixture, isLoading: false, error: null }),
}));

vi.mock('@/lib/home-navigation', () => ({
  flushPendingHomeTarget: vi.fn(),
  scrollToHomeTarget,
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
});

describe('showroom search filters', () => {
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
    expect(screen.getAllByRole('link', { name: /Book a viewing/i }).length).toBeGreaterThan(0);
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