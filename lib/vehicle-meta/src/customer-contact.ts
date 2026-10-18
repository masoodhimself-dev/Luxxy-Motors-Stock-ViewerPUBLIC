/** Contact comparisons suggest records for staff review; they never prove identity or merge records. */
export type CustomerContact = {
  dealerId?: string | null;
  customerName?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};
export type CustomerContactMatch = {
  status: 'exact' | 'review' | 'none';
  matchedBy: Array<'email' | 'phone'>;
  issues: string[];
  label: string;
};
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function canonicalCustomerEmail(value: unknown): string {
  const email = text(value).toLowerCase();
  // Preserve dots, plus tags and domains: provider-specific aliases are not identity evidence.
  return email.length <= 320 && /^[^\s@\u0000-\u001f]+@[^\s@\u0000-\u001f]+\.[^\s@\u0000-\u001f]+$/.test(email) ? email : '';
}

export function canonicalCustomerPhone(value: unknown): string {
  let phone = text(value);
  // A written optional UK trunk prefix is unambiguous; arbitrary leading zeroes are not.
  phone = phone.replace(/^(\+44|0044)\s*\(0\)/, '$1');
  phone = phone.replace(/[\s().\-/]/g, '');
  if (!/^\+?\d+$/.test(phone)) return '';
  if (phone.startsWith('00')) phone = `+${phone.slice(2)}`;
  else if (/^0[1-9]\d{9}$/.test(phone)) phone = `+44${phone.slice(1)}`;
  else if (/^44[1-9]\d{9}$/.test(phone)) phone = `+${phone}`;
  // Other countries require an explicit country prefix. Never compare local-number suffixes.
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) return '';
  if (phone.startsWith('+44') && !/^\+44[1-9]\d{9}$/.test(phone)) return '';
  return phone;
}

export function canonicalCustomerName(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, ' ');
}

export function assessCustomerContact(a: CustomerContact, b: CustomerContact): CustomerContactMatch {
  const leftDealer = text(a.dealerId), rightDealer = text(b.dealerId);
  if (leftDealer && rightDealer && leftDealer !== rightDealer) {
    return { status: 'none', matchedBy: [], issues: [], label: 'Separate dealership records' };
  }
  const email = canonicalCustomerEmail(a.email), otherEmail = canonicalCustomerEmail(b.email);
  const phone = canonicalCustomerPhone(a.phone), otherPhone = canonicalCustomerPhone(b.phone);
  const matchedBy: CustomerContactMatch['matchedBy'] = [];
  if (email && email === otherEmail) matchedBy.push('email');
  if (phone && phone === otherPhone) matchedBy.push('phone');
  if (!matchedBy.length) return { status: 'none', matchedBy, issues: [], label: 'No exact contact match' };
  const issues: string[] = [];
  if (email && otherEmail && email !== otherEmail) issues.push('Email addresses differ.');
  if (phone && otherPhone && phone !== otherPhone) issues.push('Phone numbers differ.');
  const name = canonicalCustomerName(a.customerName ?? a.name), otherName = canonicalCustomerName(b.customerName ?? b.name);
  if (!name || !otherName) issues.push('A customer name is missing.');
  else if (name !== otherName) issues.push('Names differ; this contact may be shared by a household or business.');
  if ((text(a.email) && !email) || (text(b.email) && !otherEmail) || (text(a.phone) && !phone) || (text(b.phone) && !otherPhone)) {
    issues.push('Another contact detail could not be checked.');
  }
  return { status: issues.length ? 'review' : 'exact', matchedBy, issues, label: `Same ${matchedBy.join(' and ')}` };
}
