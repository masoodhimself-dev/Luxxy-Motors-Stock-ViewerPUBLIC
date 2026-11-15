import { formatRegistrationPlate } from "./registration.ts";

/** WhatsApp needs international digits, without spaces, + or a UK trunk zero. */
export function customerWhatsAppNumber(value: string): string | null {
  const raw = value.trim();
  if (!raw || /[^\d\s+().-]/.test(raw) || (raw.match(/\+/g)?.length ?? 0) > 1 || (raw.includes('+') && !raw.startsWith('+'))) return null;
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0') && !raw.startsWith('+')) {
    if (digits.length !== 11) return null;
    digits = `44${digits.slice(1)}`;
  }
  if (digits.startsWith('440')) digits = `44${digits.slice(3)}`;
  // Bare foreign local numbers are ambiguous: ask for +country code instead.
  if (!raw.startsWith('+') && !raw.startsWith('00') && !raw.startsWith('0') && !digits.startsWith('44')) return null;
  if (!/^[1-9]\d{7,14}$/.test(digits) || (digits.startsWith('44') && digits.length !== 12)) return null;
  return digits;
}
export function customerWhatsAppUrl(number: string, message: string) {
  const phone = customerWhatsAppNumber(number);
  if (!phone) return null;
  // In Unicode mode this matches lone surrogates, leaving paired characters intact.
  const safeMessage = message.replace(/[\uD800-\uDFFF]/gu, '\uFFFD');
  return `https://wa.me/${phone}?text=${encodeURIComponent(safeMessage)}`;
}

type CustomerWhatsAppDraftDetails = {
  customerName?: string | null;
  vehicleTitle?: string | null;
  registration?: string | null;
  mileage?: number | null;
  price?: number | null;
  vehicleUrl?: string | null;
};

const mileageFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const priceFormat = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function singleLine(value?: string | null): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

/** An editable draft. The blank line after the greeting is for the dealer. */
export function customerWhatsAppDraft(details: CustomerWhatsAppDraftDetails): string {
  const name = singleLine(details.customerName).split(' ')[0]?.slice(0, 70) || 'there';
  const registration = formatRegistrationPlate(singleLine(details.registration));
  const mileage = typeof details.mileage === 'number' && Number.isFinite(details.mileage) && details.mileage >= 0
    ? `${mileageFormat.format(details.mileage)} miles`
    : '';
  const price = typeof details.price === 'number' && Number.isFinite(details.price) && details.price > 0
    ? priceFormat.format(details.price)
    : '';
  const vehicleLines = [
    singleLine(details.vehicleTitle).slice(0, 140),
    [registration, mileage, price].filter(Boolean).join(' · '),
    singleLine(details.vehicleUrl),
  ].filter(Boolean);
  const vehicle = vehicleLines.length ? `${vehicleLines.join('\n')}\n\n` : '';
  return `${vehicle}Hi ${name},\n\n`;
}
