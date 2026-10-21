import { it, expect } from 'vitest';
import { customerWhatsAppNumber, customerWhatsAppUrl } from './customer-whatsapp';
it('normalises UK local, international UK and foreign international numbers', () => {
 for (const value of ['07700 900123', '+44 7700 900123', '0044 7700 900123', '+44 (0)7700 900123', '447700900123']) expect(customerWhatsAppNumber(value)).toBe('447700900123');
 expect(customerWhatsAppNumber('+353 86 123 4567')).toBe('353861234567');
 expect(customerWhatsAppNumber('001 202 555 0123')).toBe('12025550123');
});
it('rejects missing, ambiguous, malformed and extension numbers instead of guessing', () => {
 for (const value of ['', '1234', '7700900123', '07700900123 ext 4', '++447700900123', '+44 7700', '+07700900123']) expect(customerWhatsAppNumber(value)).toBeNull();
});
it('encodes messages and secure attachment links without changing the recipient', () => {
 const message='Hello Alex & family\nInvoice: https://dealer.test/phone-share#secret';
 const url=new URL(customerWhatsAppUrl('07700 900123',message)!);
 expect(url.pathname).toBe('/447700900123'); expect(url.searchParams.get('text')).toBe(message);
});
