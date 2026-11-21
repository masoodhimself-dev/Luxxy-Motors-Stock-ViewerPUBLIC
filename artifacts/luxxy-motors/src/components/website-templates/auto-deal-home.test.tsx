import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MotHistory } from '@workspace/vehicle-meta';
import type { Car } from '@/lib/stock-context';
import { AutoDealHomeHero } from './auto-deal-home';

const request = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch: request }));

const first = {
  id: 'car-a', make: 'Ford', model: 'Focus', year: 2018, plate: 'AB18 CDE',
  heroImage: 'https://photos.example.test/focus.jpg', images: [], price: 7000, mileage: 50000,
} as unknown as Car;
const second = {
  ...first, id: 'car-b', make: 'Volvo', model: 'V90', plate: 'AB20 FGH',
  heroImage: 'https://photos.example.test/v90.jpg', year: 2020,
} as Car;
const settings = { presentation: { includedItems: ['6 months warranty'] } };
const history = (registration: string): MotHistory => ({
  registration, make: 'FORD', model: 'FOCUS', checkedAt: '2026-11-21T09:00:00Z', recall: 'Unknown',
  tests: [{
    completedDate: '2026-10-03T10:00:00Z', expiryDate: '2027-10-02', result: 'PASSED',
    mileage: '42000', mileageUnit: 'MI', defects: [],
  }],
});
const props = {
  cars: [first, second], loading: false, error: null, settings, headline: 'Welcome to the showroom',
  search: <button type="button">Search stock</button>,
};
const slide = () => within(screen.getByTestId('autodeal-home-hero'));
const active = (name: string) => expect(slide().getByRole('img', { name })).toBeVisible();
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  request.mockReset().mockResolvedValue({ status: 'missing' });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('rotates automatically, pauses explicitly and stays paused after manual navigation or keyboard focus', async () => {
  vi.useFakeTimers();
  render(<AutoDealHomeHero {...props} />);
  active('Ford Focus');
  await advance(8000);
  active('Volvo V90');
  fireEvent.click(slide().getByRole('button', { name: 'Pause featured cars' }));
  await advance(16000);
  active('Volvo V90');
  fireEvent.click(slide().getByRole('button', { name: 'Previous featured car' }));
  active('Ford Focus');
  await advance(8000);
  active('Ford Focus');
  fireEvent.click(slide().getByRole('button', { name: 'Play featured cars' }));
  await advance(8000);
  active('Volvo V90');
  fireEvent.focus(slide().getByRole('button', { name: 'Search stock' }));
  await advance(8000);
  active('Volvo V90');
});

it('starts with rotation off when reduced motion is preferred', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(<AutoDealHomeHero {...props} />);
  expect(slide().getByRole('button', { name: 'Play featured cars' })).toBeVisible();
  await advance(16000);
  active('Ford Focus');
  fireEvent.click(slide().getByRole('button', { name: 'Next featured car' }));
  active('Volvo V90');
});

it('renders each car’s confirmed MOT and supported warranty without asking DVSA to fetch a record', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
  request.mockImplementation((url: string) => Promise.resolve({
    status: 'available', history: history(url.includes('car-a') ? 'AB18CDE' : 'XX20XXX'),
  }));
  render(<AutoDealHomeHero {...props} cars={[first, { ...second, description: 'No warranty included.' }]} />);
  active('Ford Focus');
  expect(slide().getAllByText('6-month warranty included')).toHaveLength(2);
  await waitFor(() => expect(slide().getAllByText('MOT expires 2 October 2027')).toHaveLength(2));
  fireEvent.click(slide().getByRole('button', { name: 'Next featured car' }));
  active('Volvo V90');
  expect(slide().queryByText(/warranty included/i)).not.toBeInTheDocument();
  expect(slide().queryByText(/MOT expires/i)).not.toBeInTheDocument();
  await act(async () => {});
  expect(slide().queryByText(/MOT expires/i)).not.toBeInTheDocument();
  fireEvent.click(slide().getByRole('button', { name: 'Previous featured car' }));
  expect(slide().getAllByText('MOT expires 2 October 2027')).toHaveLength(2);
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    '/api/vehicles/car-a/mot-history?cacheOnly=true',
    '/api/vehicles/car-b/mot-history?cacheOnly=true',
  ]);
});

it('uses the listed car’s different cover duration and leaves unrelated dealerships’ cover blank', async () => {
  const carWithItsOwnCover = { ...first, description: '3 months warranty included.' };
  const view = render(<AutoDealHomeHero {...props} cars={[carWithItsOwnCover]} />);
  expect(slide().getAllByText('3-month warranty included')).toHaveLength(2);
  expect(slide().queryByRole('group', { name: 'Featured car controls' })).not.toBeInTheDocument();
  view.rerender(<AutoDealHomeHero {...props} settings={{ presentation: {} }} cars={[second]} />);
  expect(slide().queryByText(/warranty included/i)).not.toBeInTheDocument();
  await act(async () => {});
});
