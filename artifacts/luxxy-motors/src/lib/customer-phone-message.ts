/** The reviewed message must be identical on desktop, phone and in history. */
export function customerPhoneMessage(message: string, hasAttachments: boolean, url: string) {
  return message + (hasAttachments ? `\n\nView your documents and photos (available for 24 hours):\n${url}` : '');
}
