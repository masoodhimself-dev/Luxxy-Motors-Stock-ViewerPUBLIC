/** Remove only an untouched, complete shortcut paragraph. Customer edits survive. */
export function removeEnquiryShortcut(message: string, text: string): string {
  const paragraphs = message.split(/(\n\n+)/);
  const index = paragraphs.findIndex((part) => part === text);
  if (index < 0) return message;
  if (index > 0) paragraphs.splice(index - 1, 2);
  else paragraphs.splice(0, paragraphs.length > 1 ? 2 : 1);
  return paragraphs.join("");
}
