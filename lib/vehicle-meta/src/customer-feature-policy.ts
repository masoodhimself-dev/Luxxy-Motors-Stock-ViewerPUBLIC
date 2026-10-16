/**
 * The practical dealer release. These modules are retained for a later release,
 * but a previously enabled dealer setting cannot enable them in this release.
 * Staff sales deposits, manual reservations and historic records are unaffected.
 */
export const customerFeaturePolicy: Readonly<Record<
  'websiteChat' | 'onlineCardReservations' | 'vehicleComparison' | 'recentHandovers',
  boolean
>> = Object.freeze({
  websiteChat: false,
  onlineCardReservations: false,
  vehicleComparison: false,
  recentHandovers: false,
});

type CustomerFeatureSettings = {
  onlineReservation?: { enabled: boolean };
  presentation?: { comparisonEnabled?: boolean };
  recentHandovers?: { enabled: boolean };
};

/** Effective public configuration; never mutates or deletes saved dealer settings. */
export function applyCustomerFeaturePolicy<T extends CustomerFeatureSettings>(settings: T): T {
  return {
    ...settings,
    ...(settings.onlineReservation ? { onlineReservation: {
      ...settings.onlineReservation,
      enabled: customerFeaturePolicy.onlineCardReservations && settings.onlineReservation.enabled,
    } } : {}),
    ...(settings.presentation ? { presentation: {
      ...settings.presentation,
      comparisonEnabled: customerFeaturePolicy.vehicleComparison && !!settings.presentation.comparisonEnabled,
    } } : {}),
    ...(settings.recentHandovers ? { recentHandovers: {
      ...settings.recentHandovers,
      enabled: customerFeaturePolicy.recentHandovers && settings.recentHandovers.enabled,
    } } : {}),
  };
}

/** Shared by the authenticated application and local development service. */
export function deferredCustomerFeatureResponse(path: string, method: string): {
  status: number;
  body: Record<string, unknown>;
} | null {
  // Express routes are case-insensitive by default; the guard must be too.
  const route = path.toLowerCase().replace(/^\/api(?=\/)/, '').replace(/\/+$/, '') || '/';
  const verb = method.toUpperCase();
  if (!customerFeaturePolicy.onlineCardReservations) {
    if (verb === 'POST' && ['/reservations', '/reservations/checkout'].includes(route)) {
      return { status: 410, body: { error: 'Online reservations are unavailable. Please contact the showroom to arrange a deposit.' } };
    }
    if (verb === 'GET' && route === '/reservations/payment-readiness') {
      return { status: 200, body: { enabled: false, mode: null, prepared: true } };
    }
  }
  if (!customerFeaturePolicy.websiteChat && !['GET', 'HEAD', 'OPTIONS'].includes(verb)
    && /^\/chat\/conversations(?:\/|$)/.test(route)) {
    return { status: 410, body: { error: 'Website chat is unavailable. Please send an enquiry or call the showroom.' } };
  }
  if (!customerFeaturePolicy.recentHandovers && verb === 'GET' && route === '/recent-handovers') {
    return { status: 200, body: { schemaVersion: 1, handovers: [] } };
  }
  return null;
}
