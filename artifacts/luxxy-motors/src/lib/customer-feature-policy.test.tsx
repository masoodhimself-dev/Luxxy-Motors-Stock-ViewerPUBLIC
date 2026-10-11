import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyCustomerFeaturePolicy,
  customerFeaturePolicy,
  deferredCustomerFeatureResponse,
} from '@workspace/vehicle-meta';
import { CustomerChat } from '@/components/customer-chat';

vi.mock('wouter', () => ({ useLocation: () => ['/stock', vi.fn()], useRoute: () => [false, null], Link: () => null }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: [] } }) }));
afterEach(() => vi.unstubAllGlobals());

describe('practical release customer features', () => {
  it('overrides old enabled flags without modifying saved dealer data or core services', () => {
    const saved = {
      onlineReservation: { enabled: true, depositPence: 15000, terms: 'Keep these terms' },
      presentation: { comparisonEnabled: true, reviewsEnabled: true },
      recentHandovers: { enabled: true, count: 4 },
      warranty: { enabled: true },
      testDriveBooking: { enabled: true },
    };
    const effective = applyCustomerFeaturePolicy(saved);
    expect(effective.onlineReservation).toEqual({ enabled: false, depositPence: 15000, terms: 'Keep these terms' });
    expect(effective.presentation).toEqual({ comparisonEnabled: false, reviewsEnabled: true });
    expect(effective.recentHandovers).toEqual({ enabled: false, count: 4 });
    expect(effective.warranty.enabled).toBe(true);
    expect(effective.testDriveBooking.enabled).toBe(true);
    expect(saved.onlineReservation.enabled).toBe(true);
    expect(saved.presentation.comparisonEnabled).toBe(true);
    expect(saved.recentHandovers.enabled).toBe(true);
  });

  it.each(['/api/reservations', '/api/reservations/checkout', '/api/Reservations/Checkout/', '/api/chat/conversations', '/api/chat/conversations/old-thread/messages', '/api/chat/conversations/old-thread/contact', '/api/chat/conversations/old-thread/handover'])('refuses public creation through %s even with old settings or a stale browser', (path) => {
    expect(deferredCustomerFeatureResponse(path, 'POST')?.status).toBe(410);
  });

  it.each([
    ['/api/staff/stripe-reservations', 'GET'],
    ['/api/staff/stripe-reservations/old/email', 'POST'],
    ['/api/reservations/stripe/webhook', 'POST'],
    ['/api/reservations/payment-status', 'POST'],
    ['/api/reservations/old/cancel', 'POST'],
    ['/api/reservations', 'GET'],
    ['/api/staff/chat/conversations', 'GET'],
    ['/api/chat/conversations/old-thread', 'GET'],
    ['/api/staff/sale-workspace/deal/payments', 'POST'],
    ['/api/enquiries', 'POST'],
    ['/api/test-drive-bookings', 'POST'],
  ])('keeps historical management and essential workflows: %s', (path, method) => {
    expect(deferredCustomerFeatureResponse(path, method)).toBeNull();
  });

  it('reports payments unavailable and publishes no handovers', () => {
    expect(deferredCustomerFeatureResponse('/api/reservations/payment-readiness', 'GET')?.body).toEqual({ enabled: false, mode: null, prepared: true });
    expect(deferredCustomerFeatureResponse('/api/recent-handovers', 'GET')?.body).toEqual({ schemaVersion: 1, handovers: [] });
  });

  it('does not display or poll customer chat, even if a stale server could report it enabled', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render(<CustomerChat />);
    expect(customerFeaturePolicy.websiteChat).toBe(false);
    expect(screen.queryByRole('button', { name: 'Ask us' })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
