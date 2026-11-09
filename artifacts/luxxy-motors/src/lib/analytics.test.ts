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

describe('customer journey measurement', () => {
  afterEach(() => { delete window.umami; vi.resetModules(); vi.unstubAllGlobals(); });

  it('records actual success stages once and keeps customer text out of funnel data', async () => {
    vi.resetModules();
    const analytics = await import('./analytics');
    const track = vi.fn(); window.umami = { track };
    const request = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', request);
    analytics.trackEvent('stock_results_viewed', { result_count: 4 });
    analytics.trackEvent('stock_results_viewed', { result_count: 2 });
    analytics.trackEvent('vehicle_viewed', { source: 'vehicle_page' });
    analytics.trackEvent('enquiry_submitted', { enquiry_type: 'viewing' });
    let stages = track.mock.calls.filter(([event]) => event === 'customer_journey');
    expect(stages.map(([, data]) => data.stage)).toEqual(['search', 'vehicle']);
    analytics.trackEvent('enquiry_completed', { enquiry_type: 'viewing' });
    stages = track.mock.calls.filter(([event]) => event === 'customer_journey');
    expect(stages.map(([, data]) => data.stage)).toEqual(['search', 'vehicle', 'enquiry', 'appointment_request']);
    expect(stages.at(-1)?.[1]).toEqual({ stage: 'appointment_request', searched: true, viewed_vehicle: true, sent_enquiry: true, requested_appointment: true });
    expect(stages.every(([, data]) => Object.values(data).every(value => typeof value === 'boolean' || ['search','vehicle','enquiry','appointment_request'].includes(value as string)))).toBe(true);
    expect(request.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual([
      {stage:'search'}, {stage:'vehicle'}, {stage:'enquiry'}, {stage:'appointment_request'},
    ]);
  });

  it('keeps a direct enquiry separate from a search-led journey and tolerates blocked tracking', async () => {
    vi.resetModules();
    const analytics = await import('./analytics');
    const track = vi.fn(); window.umami = { track };
    analytics.trackEvent('enquiry_completed', { enquiry_type: 'general' });
    expect(track).toHaveBeenCalledWith('customer_journey', { stage: 'enquiry', searched: false, viewed_vehicle: false, sent_enquiry: true, requested_appointment: false });
    window.umami = { track: () => { throw new Error('blocked'); } };
    expect(() => analytics.trackEvent('vehicle_viewed')).not.toThrow();
  });

  it('honours a browser privacy signal without sending journey data', async () => {
    vi.resetModules();
    const analytics = await import('./analytics');
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    vi.stubGlobal('navigator', { doNotTrack: '1' });
    const track = vi.fn(); window.umami = { track };
    analytics.trackJourneyStage('vehicle');
    expect(request).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });
});
