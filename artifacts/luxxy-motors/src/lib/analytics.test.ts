import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from './analytics';

describe('trackEvent', () => {
  afterEach(() => {
    delete window.umami;
  });

  it('forwards safe event data when analytics is available', () => {
    const track = vi.fn();
    window.umami = { track };

    trackEvent('vehicle_opened', { source: 'showroom', layout: 'card' });

    expect(track).toHaveBeenCalledWith('vehicle_opened', { source: 'showroom', layout: 'card' });
  });

  it('does not throw when analytics is absent or fails', () => {
    expect(() => trackEvent('vehicle_opened')).not.toThrow();
    window.umami = { track: () => { throw new Error('blocked'); } };
    expect(() => trackEvent('vehicle_opened')).not.toThrow();
  });
});