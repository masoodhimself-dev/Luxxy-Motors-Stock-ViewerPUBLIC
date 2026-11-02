/** Staff-reviewed review requests. No messages are sent by these helpers. */
export function googleReviewUrl(value: string): string | null {
  if (typeof value !== 'string' || value.length > 1000) return null;
  const clean = value.trim();
  const match = /^https:\/\/([a-z0-9.-]+)(?:[/?#][^\s\\]*)?$/i.exec(clean);
  if (!match) return null;
  const host = match[1].toLowerCase();
  return ['google.com', 'google.co.uk', 'g.page', 'maps.app.goo.gl'].some(domain => host === domain || host.endsWith('.' + domain)) ? clean : null;
}
export const reviewReminderNote = (url: string) => `Google review request\n${url}`;
export function reviewReminderEmail(note: string | null | undefined, customer: string, _vehicle: string, dealer: string) {
  const lines = (note || '').split('\n');
  const url = lines[0] === 'Google review request' ? googleReviewUrl(lines[1]) : null;
  if (!url) return null;
  return { subject: `Share your experience with ${dealer}`, message: `Hi ${customer || 'there'},\n\nIf you’d like to share your experience with ${dealer}, you can leave an honest Google review here:\n${url}\n\nThank you,\n${dealer}` };
}
