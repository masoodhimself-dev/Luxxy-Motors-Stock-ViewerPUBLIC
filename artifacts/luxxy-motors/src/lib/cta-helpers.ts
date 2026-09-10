import { getRecordContactIntentUrl } from '@workspace/api-client-react';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { getVisitorId } from '@/lib/visitor';
import { trackEvent } from '@/lib/analytics';

type DealerContactDetails = {
  contact: {
    phone?: string;
    whatsapp?: string;
  };
  identity: {
    name: string;
  };
};

function getWhatsAppNumber(config: DealerContactDetails = dealerConfig) {
  return config.contact.whatsapp?.replace(/\D/g, '');
}

function getPhoneNumber(config: DealerContactDetails = dealerConfig) {
  return config.contact.phone?.replace(/[^0-9+]/g, '');
}

export function getPhoneHref(config: DealerContactDetails = dealerConfig) {
  const phone = getPhoneNumber(config);
  return phone ? `tel:${phone}` : undefined;
}

export function getWhatsAppHref(message?: string, config: DealerContactDetails = dealerConfig) {
  const whatsapp = getWhatsAppNumber(config);
  if (!whatsapp) return undefined;
  return `https://wa.me/${whatsapp}${message ? `?text=${encodeURIComponent(message)}` : ''}`;
}

export function getContactHref(subject?: string) {
  const normalized = (subject || '').toLowerCase();
  if (normalized.includes('part exchange')) return getEnquiryHref('part_exchange');
  if (normalized.includes('warranty')) return getEnquiryHref('warranty');
  if (normalized.includes('delivery')) return getEnquiryHref('delivery');
  if (normalized.includes('viewing') || normalized.includes('booking')) return getEnquiryHref('viewing');
  return getEnquiryHref('general');
}

function getVehicleLabel(car: Car) {
  return car.title || [car.make, car.model].filter(Boolean).join(' ') || 'this vehicle';
}

/**
 * The link to hand to someone outside the app.
 *
 * It points at the API server's `/share/vehicle/:id` page rather than the SPA
 * route, because WhatsApp and the other messaging previewers do not run
 * JavaScript and would otherwise show the generic site card. That page carries
 * the vehicle's own Open Graph tags and forwards real visitors to
 * `/vehicle/:id`, which stays the canonical URL.
 */
export function getVehicleShareUrl(car: Car) {
  const path = `/share/vehicle/${encodeURIComponent(car.id)}`;
  return typeof window !== 'undefined' ? `${window.location.origin}${path}` : path;
}

export function getVehicleContactMessage(car: Car, request: string, config: DealerContactDetails = dealerConfig) {
  const details = [
    getVehicleLabel(car),
    car.registration || car.plate ? `Registration: ${car.registration || car.plate}` : null,
    car.price ? `Price: ${car.currency || 'GBP'} ${car.price.toLocaleString('en-GB')}` : null,
  ].filter(Boolean);

  return `Hello ${config.identity.name}, I would like to ${request}:\n${details.join('\n')}\nVehicle link: ${getVehicleShareUrl(car)}`;
}

export function getVehicleWhatsAppHref(car: Car, request: string, config: DealerContactDetails = dealerConfig) {
  return getWhatsAppHref(getVehicleContactMessage(car, request, config), config);
}

export function getVehicleBookingHref(car: Car) {
  return getEnquiryHref('viewing', car);
}

/**
 * Records that someone tapped Call or WhatsApp, so phone traffic stops being
 * invisible to the dealer. It is fire-and-forget: the tap must never be blocked
 * or delayed by the logging, and a failure is silently ignored.
 */
export function recordContactIntent({
  channel,
  car,
  source,
}: {
  channel: 'call' | 'whatsapp';
  car?: Car;
  source?: string;
}) {
  trackEvent('contact_clicked', {
    channel,
    source: source ?? 'unknown',
    vehicle_context: Boolean(car),
  });

  if (typeof window === 'undefined') return;
  const body = JSON.stringify({
    channel,
    vehicleId: car?.id ?? null,
    visitorId: getVisitorId(),
    source: source ?? null,
  });
  const url = getRecordContactIntentUrl();
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      // Survives the browser leaving the page for the dialler or WhatsApp.
      const sent = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      if (sent) return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never let analytics get in the way of a phone call.
  }
}

export function recordBookingIntent({
  source,
  vehicleContext = false,
}: {
  source: string;
  vehicleContext?: boolean;
}) {
  trackEvent('booking_started', {
    source,
    vehicle_context: vehicleContext,
  });
}
export type EnquiryType = 'viewing' | 'general' | 'delivery' | 'warranty' | 'part_exchange';

export function getEnquiryHref(type: EnquiryType, car?: Car) {
  const params = new URLSearchParams({ type });
  if (car?.id) params.set('vehicleId', car.id);
  return `/enquire?${params.toString()}`;
}
