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
export function reviewReminderEmail(note: string | null | undefined, customer: string, vehicle: string, dealer: string) {
  const lines = (note || '').split('\n');
  const url = lines[0] === 'Google review request' ? googleReviewUrl(lines[1]) : null;
  if (!url) return null;
  return { subject: `How are you getting on with your car? — ${dealer}`, message: `Hi ${customer || 'there'},\n\nThank you for choosing ${dealer}. We hope you’re enjoying ${vehicle ? `your ${vehicle}` : 'your new car'}.\n\nIf you have any questions, just reply and we’ll be happy to help.\n\nIf you’d like to share your experience, you can leave an honest Google review here:\n${url}\n\nThanks again,\n${dealer}` };
}
