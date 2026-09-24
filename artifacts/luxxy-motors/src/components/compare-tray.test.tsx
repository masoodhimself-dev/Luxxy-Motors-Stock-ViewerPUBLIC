vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { presentation: { comparisonEnabled: true } } }) }));
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CompareTray, routeAllowsCompareTray } from '@/components/compare-tray';
import { SavedCarsProvider, useSavedCars } from '@/lib/saved-cars-context';

const stockState = vi.hoisted(() => ({ stock: { cars: [] }, isLoading: false, error: null as string | null }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => stockState }));

function ComparisonCount() {
  const { compareCount } = useSavedCars();
  return <span data-testid="comparison-count">{compareCount}</span>;
}

beforeEach(() => {
  stockState.error = null;
  window.localStorage.clear();
  window.localStorage.setItem('luxxy.compare-cars.v1', '["unavailable-one","unavailable-two"]');
});

it('releases comparison slots when a successful stock response is empty', async () => {
  render(<SavedCarsProvider><CompareTray /><ComparisonCount /></SavedCarsProvider>);
  await waitFor(() => expect(screen.getByTestId('comparison-count')).toHaveTextContent('0'));
});

it('keeps comparison selections through a stock-loading failure', () => {
  stockState.error = 'Network unavailable';
  render(<SavedCarsProvider><CompareTray /><ComparisonCount /></SavedCarsProvider>);
  expect(screen.getByTestId('comparison-count')).toHaveTextContent('2');
});

describe('comparison tray route placement', () => {
  it('leaves the vehicle-detail bottom edge clear for mobile conversion actions', () => {
    expect(routeAllowsCompareTray('/vehicle/car-123')).toBe(false);
  });

  it('returns on stock browsing routes without clearing the comparison', () => {
    expect(routeAllowsCompareTray('/')).toBe(true);
    expect(routeAllowsCompareTray('/saved')).toBe(true);
  });

  it('keeps staff and secure customer workflows clear', () => {
    for (const path of ['/portal', '/portal/leads/123', '/enquire', '/viewing/token', '/customer-details/token', '/sign/token']) {
      expect(routeAllowsCompareTray(path)).toBe(false);
    }
  });

  it('stays out of the dedicated comparison page', () => {
    expect(routeAllowsCompareTray('/compare')).toBe(false);
  });
});
