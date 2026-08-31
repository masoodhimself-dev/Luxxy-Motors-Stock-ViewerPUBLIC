import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';

function getWhatsAppNumber() {
  return dealerConfig.contact.whatsapp?.replace(/\D/g, '');
}

function getPhoneNumber() {
  return dealerConfig.contact.phone?.replace(/[^0-9+]/g, '');
}

export function getPhoneHref() {
  const phone = getPhoneNumber();
  return phone ? `tel:${phone}` : undefined;
}

export function getWhatsAppHref(message?: string) {
  const whatsapp = getWhatsAppNumber();
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

export function getVehicleContactMessage(car: Car, request: string) {
  const details = [
    getVehicleLabel(car),
    car.registration || car.plate ? `Registration: ${car.registration || car.plate}` : null,
    car.price ? `Price: ${car.currency || 'GBP'} ${car.price.toLocaleString('en-GB')}` : null,
  ].filter(Boolean);
  const vehicleUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/vehicle/${encodeURIComponent(car.id)}`
    : `/vehicle/${encodeURIComponent(car.id)}`;

  return `Hello ${dealerConfig.identity.name}, I would like to ${request}:\n${details.join('\n')}\nVehicle link: ${vehicleUrl}`;
}

export function getVehicleWhatsAppHref(car: Car, request: string) {
  return getWhatsAppHref(getVehicleContactMessage(car, request));
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
