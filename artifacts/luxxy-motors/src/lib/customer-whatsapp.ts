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
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null;
}
