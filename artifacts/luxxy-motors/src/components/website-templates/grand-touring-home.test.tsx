import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { GrandTouringHomepage, type GrandTouringHomepageProps } from './grand-touring-home';

const car = (id: string, make: string, model: string, price: number) => ({
  id, advertId: id, make, model, title: `${make} ${model}`, price, currency: 'GBP',
  year: 2020, mileage: 32000, fuel: 'Petrol', transmission: 'Manual',
  registration: 'AB20 CDE', heroImage: `https://images.example/${id}.jpg`, images: [],
  inventoryStatus: 'available', sourceExtras: null,
} as unknown as Car);
const cars = [car('honda', 'Honda', 'Civic', 8500), car('bmw', 'BMW', 'X6', 15000), car('volvo', 'Volvo', 'V90', 12500), car('toyota', 'Toyota', 'Yaris', 6500)];
const props = (overrides: Partial<GrandTouringHomepageProps> = {}): GrandTouringHomepageProps => ({
  settings: { ...dealerConfig, identity: { name: 'Harbour Cars' }, address: { city: 'Brighton' } },
  cars, featured: [cars[3], cars[0], cars[2], cars[1]], headline: 'Used cars for sale', location: 'Used cars in Brighton',
  photo: '/old-configured-hero.jpg', search: <form aria-label="Search used cars"><button>Search cars</button></form>,
  makes: null, reasons: null, reviews: null, partExchange: null, bodyTypes: null, visit: null, contact: null,
  finder: null, faqs: [], isLoading: false, error: null, ...overrides,
});
function renderHome(overrides: Partial<GrandTouringHomepageProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SavedCarsProvider persistent={false}><GrandTouringHomepage {...props(overrides)} /></SavedCarsProvider></QueryClientProvider>);
}
afterEach(cleanup);

it('uses the shared featured order and real stock photographs without a separate hero image', () => {
  renderHome();
  expect(screen.getAllByRole('article').map(article => article.getAttribute('aria-label'))).toEqual(['Toyota Yaris', 'Honda Civic', 'Volvo V90']);
  expect(screen.queryByRole('heading', { name: 'BMW X6' })).not.toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Toyota Yaris' })).toHaveAttribute('src', expect.stringContaining('/toyota.jpg'));
  expect(document.querySelector('img[src="/old-configured-hero.jpg"]')).toBeNull();
  const toyota = screen.getByRole('article', { name: 'Toyota Yaris' });
  expect(within(toyota).getByText('£6,500')).toBeInTheDocument();
  expect(within(toyota).getByRole('link', { name: 'View car' })).toHaveAttribute('href', '/vehicle/toyota');
  const save = within(toyota).getByRole('button', { name: 'Save Toyota Yaris to your saved cars' });
  fireEvent.click(save);
  expect(within(toyota).getByRole('button', { name: 'Remove Toyota Yaris from your saved cars' })).toHaveAttribute('aria-pressed', 'true');
});

it('uses the real locality for a generic title and keeps supplied dealer wording', () => {
  const view = renderHome();
  expect(screen.getByRole('heading', { level: 1, name: 'Used cars in Brighton' })).toBeInTheDocument();
  const supplied = { ...props().settings, hero: { ...dealerConfig.hero, announcement: 'Visits by appointment', copy: 'Chosen cars from Harbour Cars', subcopy: 'Speak to our team before travelling.' }, presentation: { showHeroDescription: true } };
  view.rerender(<QueryClientProvider client={new QueryClient()}><SavedCarsProvider persistent={false}><GrandTouringHomepage {...props({ settings: supplied, headline: supplied.hero.copy })} /></SavedCarsProvider></QueryClientProvider>);
  expect(screen.getByRole('heading', { level: 1, name: supplied.hero.copy })).toBeInTheDocument();
  expect(screen.getByText('Visits by appointment')).toBeInTheDocument();
  expect(screen.getByText(supplied.hero.subcopy)).toBeInTheDocument();
});

it('does not advertise stale featured cars while stock is loading or unavailable', () => {
  const view = renderHome({ isLoading: true });
  expect(screen.getByRole('status')).toHaveTextContent('Loading cars');
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  view.unmount();
  renderHome({ error: 'Could not refresh stock' });
  expect(screen.getByRole('status')).toHaveTextContent('We couldn’t load the cars');
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Browse stock' })).toHaveAttribute('href', '/stock');
});

it('keeps the search handler and enabled lower part-exchange slot usable when featured stock is disabled', () => {
  const search = vi.fn(event => event.preventDefault());
  renderHome({
    settings: { ...props().settings, presentation: { featuredEnabled: false } },
    search: <form aria-label="Search used cars" onSubmit={search}><button type="submit">Search cars</button></form>,
    partExchange: <a href="/enquire?type=part_exchange">Start part exchange</a>,
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Search used cars' }));
  expect(search).toHaveBeenCalledOnce();
  expect(screen.queryByRole('article')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Start part exchange' })).toHaveAttribute('href', '/enquire?type=part_exchange');
});
