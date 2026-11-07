export type EnquiryMessageRequest = { id: number | string; text: string };
export type EnquiryMessageAppend = { status: 'added' | 'unchanged'; message: string } | { status: 'too_long'; message: string; request: string };

/** Preparing a question must never erase a draft or shorten the customer's words. */
export function appendEnquiryMessage(current: string, requested: string, limit: number): EnquiryMessageAppend {
  const request = requested.trim();
  const comparable = current.trim();
  if (!request || comparable === request || comparable.endsWith(`\n\n${request}`) || comparable.startsWith(`${request}\n\n`) || comparable.includes(`\n\n${request}\n\n`)) return { status: 'unchanged', message: current };
  const message = current.trim() ? `${current}\n\n${request}` : request;
  return message.length <= Math.max(0, limit) ? { status: 'added', message } : { status: 'too_long', message: current, request };
}
