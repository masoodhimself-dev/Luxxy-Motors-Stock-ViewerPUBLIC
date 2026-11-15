import { AiError } from "./ai-assistance";
import { isUKNumberPlate } from "@workspace/vehicle-meta";

const placeholderStart = /\bDEALEROS_PRIVATE_/i;
const placeholder = /\[\[DEALEROS_PRIVATE_(\d+)\]\]/g;
const contactPatterns = [
  /\b(?:https?:\/\/|www\.)[^\s<>]+/gi,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  /(?<!\w)(?:\+44|0)(?:[ \t().-]*\d){9,10}(?!\w)/g,
  /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi,
  /(?<!\d)(?:\d[ \t-]*){12,18}\d(?!\d)/g,
];
const escapePattern = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function unusableDraft() {
  return new AiError(
    "invalid_ai_draft",
    "AI couldn’t safely check this draft. You can still review and send your original message.",
    422,
  );
}

/** Keep contact details out of the model input and restore them only in the staff preview. */
export function prepareStaffReplyDraft(
  draft: string,
  enquiry: { customerName?: string | null; partExchangeRegistration?: string | null },
) {
  if (placeholderStart.test(draft)) throw unusableDraft();
  const privateValues: string[] = [];
  const savePrivateValue = (value: string) => {
    privateValues.push(value);
    return "[[DEALEROS_PRIVATE_" + privateValues.length + "]]";
  };
  let text = draft;
  for (const pattern of contactPatterns) text = text.replace(pattern, savePrivateValue);
  const name = enquiry.customerName?.trim();
  if (name && name.length > 2) {
    text = text.replace(new RegExp("(?<![\\p{L}\\p{N}_])" + escapePattern(name) + "(?![\\p{L}\\p{N}_])", "giu"), savePrivateValue);
    const firstName = name.split(/\s+/)[0];
    if (firstName !== name) {
      text = text.replace(
        new RegExp("^(\\s*(?:hi|hello|dear)\\s+)(" + escapePattern(firstName) + ")(?=[\\s,!]|$)", "i"),
        (_line, greeting: string, first: string) => greeting + savePrivateValue(first),
      );
    }
  }
  const partExchangePlate = enquiry.partExchangeRegistration?.replace(/[\s-]/g, "");
  if (partExchangePlate && isUKNumberPlate(partExchangePlate)) {
    text = text.replace(
      new RegExp("\\b" + [...partExchangePlate].join("[ \\t\\u00a0\\u202f-]*") + "\\b", "gi"),
      savePrivateValue,
    );
  }

  const restore = (answer: string) => {
    const used = new Set<number>();
    const plainText = answer.replace(placeholder, (_token, digits: string) => {
      const number = Number(digits);
      if (String(number) !== digits || !privateValues[number - 1] || used.has(number)) throw unusableDraft();
      used.add(number);
      return "";
    });
    if (
      !plainText.trim() ||
      used.size !== privateValues.length ||
      placeholderStart.test(plainText) ||
      /\[(?:customer|(?:email|phone|postcode|part-exchange plate) removed)\]/i.test(plainText) ||
      /<\/?[a-z][^>]*>/i.test(plainText) ||
      contactPatterns.some((pattern) => plainText.search(pattern) !== -1)
    ) throw unusableDraft();
    return answer.trim().replace(placeholder, (_token, digits: string) => privateValues[Number(digits) - 1]);
  };

  return { text, restore };
}
