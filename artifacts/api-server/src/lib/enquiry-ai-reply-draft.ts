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

const proofreadingCorrections = new Map([
  ["accomodate", "accommodate"],
  ["adn", "and"],
  ["apointment", "appointment"],
  ["arange", "arrange"],
  ["avaliable", "available"],
  ["availble", "available"],
  ["becuase", "because"],
  ["cant", "can't"],
  ["confrim", "confirm"],
  ["conveinent", "convenient"],
  ["couldnt", "couldn't"],
  ["definately", "definitely"],
  ["dident", "didn't"],
  ["diffrent", "different"],
  ["documment", "document"],
  ["doesnt", "doesn't"],
  ["dont", "don't"],
  ["havent", "haven't"],
  ["im", "i'm"],
  ["isnt", "isn't"],
  ["milage", "mileage"],
  ["milege", "mileage"],
  ["origional", "original"],
  ["pqrking", "parking"],
  ["proffesional", "professional"],
  ["recieve", "receive"],
  ["recieved", "received"],
  ["registation", "registration"],
  ["regaurds", "regards"],
  ["tomorow", "tomorrow"],
  ["teh", "the"],
  ["thansk", "thanks"],
  ["thats", "that's"],
  ["vechile", "vehicle"],
  ["vehcile", "vehicle"],
  ["veiw", "view"],
  ["veiwing", "viewing"],
  ["waranty", "warranty"],
  ["warrenty", "warranty"],
  ["wasnt", "wasn't"],
  ["werent", "weren't"],
  ["wouldnt", "wouldn't"],
  ["youre", "you're"],
]);

const verbAgreement = [
  { forms: ["am", "are", "is"], firstPerson: "am", plural: "are", singular: "is" },
  { forms: ["have", "has"], firstPerson: "have", plural: "have", singular: "has" },
  { forms: ["do", "does"], firstPerson: "do", plural: "do", singular: "does" },
];
const singularSubject = /^(?:it|she|he)$/;
const pluralSubject = /^(?:you|we|they)$/;
const clauseBoundary = /^[.?!\n]$/;
const clauseStarter = /^(?:am|are|is|can|could|do|does|did|have|has|may|might|must|need|will|would|shall|should)$/;
const scopeMarker = /^(?:if|unless|whether|provided|assuming|when|until|except|only|no|not|never|without|neither|nor|.*n't|["“”'])$/;

function proofreadingTokens(value: string) {
  const tokens = value.trim().normalize("NFC").toLowerCase()
    .replace(/’/g, "'")
    .replace(/\r\n?/g, "\n")
    .replace(/^(hi|hello|dear)[ \t]+(\[\[dealeros_private_\d+\]\]),?[ \t]*$/gm, "$1 $2")
    .replace(/^(kind regards|best regards|many thanks|thanks|regards)[,.]?[ \t]*$/gm, "$1")
    .replace(/(?<![.!?])\.(?=$|\n[ \t]*\n)/g, "")
    .match(/\[\[dealeros_private_\d+\]\]|[\p{L}\p{M}]+(?:'[\p{L}\p{M}]+)*|\p{N}+(?:[.,]\p{N}+)*(?:st|nd|rd|th)?|\n+|[^\s]/gu)
    ?.map((token) => token.startsWith("\n") ? "\n" : token) ?? [];
  let qualifiedClause = false;
  return tokens.filter((token, index) => {
    if (clauseBoundary.test(token)) qualifiedClause = false;
    else if (scopeMarker.test(proofreadingCorrections.get(token) ?? token)) qualifiedClause = true;
    const nextSubject = tokens[index + 2] ?? "";
    // Commas at this clause boundary are stylistic in a straightforward statement.
    return token !== "," || qualifiedClause || !/^(?:and|but)$/.test(tokens[index + 1] ?? "") ||
      !(nextSubject === "i" || singularSubject.test(nextSubject) || pluralSubject.test(nextSubject)) ||
      !clauseStarter.test(tokens[index + 3] ?? "");
  });
}

function proofreadWordMatches(original: string[], index: number, revised: string) {
  const word = original[index];
  if (word === revised || proofreadingCorrections.get(word) === revised) return true;
  const subject = original[index - 1] ?? "";
  const agreement = verbAgreement.find(({ forms }) => forms.includes(word));
  if (!agreement) return false;
  if (singularSubject.test(subject)) return revised === agreement.singular;
  if (pluralSubject.test(subject)) return revised === agreement.plural;
  return subject === "i" && (index === 1 || clauseBoundary.test(original[index - 2])) && revised === agreement.firstPerson;
}

/** Accept only copy edits that preserve the staff member's wording and figures. */
export function prepareStaffReplyProofread(draft: string, enquiry: Parameters<typeof prepareStaffReplyDraft>[1]) {
  const prepared = prepareStaffReplyDraft(draft, enquiry);
  const original = proofreadingTokens(prepared.text);
  return {
    text: prepared.text,
    restore(answer: string) {
      const revised = proofreadingTokens(answer);
      if (revised.length !== original.length ||
        original.some((_token, index) => !proofreadWordMatches(original, index, revised[index]))) {
        throw unusableDraft();
      }
      return prepared.restore(answer);
    },
  };
}
