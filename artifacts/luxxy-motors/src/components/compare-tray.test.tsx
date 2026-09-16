import { describe, expect, it } from 'vitest';
import { routeAllowsCompareTray } from '@/components/compare-tray';

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