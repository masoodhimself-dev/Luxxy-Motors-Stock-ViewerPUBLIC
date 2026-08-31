import { dealerConfig } from '@/config/dealer';

export function getContactHref(subject?: string) {
  if (dealerConfig.contact.whatsapp) return `https://wa.me/${dealerConfig.contact.whatsapp.replace(/[^0-9+]/g, '')}${subject ? `?text=${encodeURIComponent(subject)}` : ''}`;
  if (dealerConfig.contact.email) return `mailto:${dealerConfig.contact.email}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`;
  if (dealerConfig.contact.phone) return `tel:${dealerConfig.contact.phone.replace(/[^0-9+]/g, '')}`;
  return '#contact';
}
