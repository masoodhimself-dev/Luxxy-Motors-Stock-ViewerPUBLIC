import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Viewing from './viewing';

vi.mock('@workspace/api-client-react', () => ({
  getGetEnquiryAvailabilityQueryKey: () => ['availability'],
  getGetViewingBookingQueryKey: () => ['booking'],
  useGetViewingBooking: () => ({ isLoading: false, isError: true, error: { status: 404 } }),
  useGetEnquiryAvailability: () => ({}),
  useCancelViewing: () => ({}),
  useRescheduleViewing: () => ({}),
}));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: [] } }) }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({
  settings: { identity: { name: 'Test Motors' }, address: {}, contact: {} }, isLoading: false,
}) }));

it('keeps private booking links out of previews and sets private-page browser policies', () => {
  window.history.replaceState({}, '', '/viewing/private-booking-token');
  const client = new QueryClient();
  const view = render(<QueryClientProvider client={client}><Viewing /></QueryClientProvider>);
  expect(screen.getByRole('heading', { name: 'Cannot find booking' })).toBeInTheDocument();
  expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  expect(document.querySelector('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute('content', window.location.origin);
  expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', window.location.origin);
  view.unmount();
  expect(document.querySelector('meta[name="robots"]')).not.toBeInTheDocument();
  expect(document.querySelector('meta[name="referrer"]')).not.toBeInTheDocument();
});
