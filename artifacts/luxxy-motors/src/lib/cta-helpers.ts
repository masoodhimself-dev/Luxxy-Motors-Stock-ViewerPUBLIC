import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';

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

export function getVehicleContactMessage(car: Car, request: string, config: DealerContactDetails = dealerConfig) {
  const details = [
    getVehicleLabel(car),
    car.registration || car.plate ? `Registration: ${car.registration || car.plate}` : null,
    car.price ? `Price: ${car.currency || 'GBP'} ${car.price.toLocaleString('en-GB')}` : null,
  ].filter(Boolean);
  const vehicleUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/vehicle/${encodeURIComponent(car.id)}`
    : `/vehicle/${encodeURIComponent(car.id)}`;

  return `Hello ${config.identity.name}, I would like to ${request}:\n${details.join('\n')}\nVehicle link: ${vehicleUrl}`;
}

export function getVehicleWhatsAppHref(car: Car, request: string, config: DealerContactDetails = dealerConfig) {
  return getWhatsAppHref(getVehicleContactMessage(car, request, config), config);
}

export function getVehicleBookingHref(car: Car) {
  return getEnquiryHref('viewing', car);
}

export type EnquiryType = 'viewing' | 'general' | 'delivery' | 'warranty' | 'part_exchange';

export function getEnquiryHref(type: EnquiryType, car?: Car) {
  const params = new URLSearchParams({ type });
  if (car?.id) params.set('vehicleId', car.id);
  return `/enquire?${params.toString()}`;
}
