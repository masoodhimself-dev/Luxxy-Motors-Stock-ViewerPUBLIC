import { privateWebsitePreviewBase } from './private-website-preview';

export type AnalyticsData = Record<string, string | number | boolean>;
export type CustomerJourneyStage = 'search' | 'vehicle' | 'enquiry' | 'appointment_request';

// Keep stage deduplication in memory for the current page session.
const journeyStages = new Set<CustomerJourneyStage>();
let journeyHost = '';

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

/**
 * Sends a privacy-safe custom event when an optional Umami integration is available.
 * Analytics is configured by the deployment owner and must never affect the journey.
 */
export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === 'undefined' || privateWebsitePreviewBase()) return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never break the showroom.
  }
  if (name === 'stock_results_viewed') trackJourneyStage('search');
  if (name === 'vehicle_viewed') trackJourneyStage('vehicle');
  if (name === 'enquiry_completed') {
    trackJourneyStage('enquiry');
    if (data?.enquiry_type === 'viewing') trackJourneyStage('appointment_request');
  }
}

export function trackJourneyStage(stage: CustomerJourneyStage): void {
  if (typeof window === 'undefined' || privateWebsitePreviewBase()) return;
  const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (privacy.doNotTrack === '1' || privacy.globalPrivacyControl === true) return;
  if (journeyHost !== window.location.host) {
    journeyHost = window.location.host;
    journeyStages.clear();
  }
  if (journeyStages.has(stage)) return;
  journeyStages.add(stage);
  try {
    void fetch('/api/website-journey', {
      method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true,
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }),
    }).catch(() => {});
  } catch {
    // Measurement is best effort, including offline and blocked browsers.
  }
  try {
    window.umami?.track('customer_journey', {
      stage,
      searched: journeyStages.has('search'),
      viewed_vehicle: journeyStages.has('vehicle'),
      sent_enquiry: journeyStages.has('enquiry'),
      requested_appointment: journeyStages.has('appointment_request'),
    });
  } catch {
    // The customer's journey is independent of the optional analytics service.
  }
}
