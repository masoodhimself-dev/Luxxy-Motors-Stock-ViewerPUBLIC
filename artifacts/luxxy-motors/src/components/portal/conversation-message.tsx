import { EnquiryTextChecks } from "./enquiry-text-checks";
/** Only folds recognised quoted history. The original is always accessible. */
export function conversationExcerpt(text: string): { text: string; folded: boolean } {
  const boundary = text.search(/\n(?:On [\s\S]{0,400}?wrote:|_{5,}|-{5,}\s*Original Message)/i);
  if (boundary <= 0) return { text, folded: false };
  return { text: text.slice(0, boundary).trimEnd(), folded: true };
}
export function ConversationMessage({ text }: { text: string }) {
  const excerpt = conversationExcerpt(text);
  return <><p className="enquiry-history-copy email-bubble-text"><EnquiryTextChecks text={excerpt.text} /></p>{excerpt.folded && <details className="conversation-original"><summary>Show original message</summary><p className="enquiry-history-copy email-bubble-text"><EnquiryTextChecks text={text} /></p></details>}</>;
}
