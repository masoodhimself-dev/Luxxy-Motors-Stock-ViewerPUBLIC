import type { Car } from './stock-context';
import { vehicleAnswers } from './vehicle-answers';
import { stockCardSellingPoints } from './stock-card-presentation';
import { buyerInformation } from './buyer-information';
import { vehicleContent } from './vehicle-content';

const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const number = (value: string) => words[value.toLowerCase()] ?? Number(value);
const qualified = /\b(?:not|no|cannot|cant|unable|unverifiable|not\s+verified|without|unknown|unconfirmed|unverified|incomplete|partial|missing|lost|may|might|could|can|will|would|should|if|unless|needs?|requires?|optional|extra|additional|except|excluding|however|but|although|subject|previously|formerly|believed|disputed|uncertain)\b|n['’]t\b|\?/i;
export type VehicleSummaryFact = { id: 'owners' | 'service' | 'keys'; text: string };

/** Shorten only recognised, unqualified facts already selected by the existing
 * description-first answers. Unfamiliar claims stay in the full description. */
export function vehiclePageSummary(car: Car): VehicleSummaryFact[] {
  const answers = vehicleAnswers(car);
  const raw = vehicleContent(car).description ?? '';
  const sentences = raw.split(/(?<=[.!?])\s+|[\r\n;]+/).map(text => text.trim()).filter(Boolean);
  const topicPatterns = { owners: /\b(?:owner|keeper)s?\b/i, service: /\bservic(?:e|es|ed|ing)\b/i, keys: /\b(?:keys?|fobs?)\b/i };
  const records = buyerInformation(car);
  const structured = {
    owners: records.find(fact => ['Owners', 'Previous keepers'].includes(fact.label))?.value ?? '',
    service: records.find(fact => fact.label === 'Service history')?.value ?? '',
    keys: records.find(fact => fact.label === 'Keys')?.value ?? '',
  };
  const hasDescriptionTopic = (id: keyof typeof topicPatterns) => sentences.some(sentence => topicPatterns[id].test(sentence));
  const sourceFor = (id: keyof typeof topicPatterns) => hasDescriptionTopic(id) ? raw : structured[id];
  const safeTopic = (id: keyof typeof topicPatterns) => hasDescriptionTopic(id)
    ? !sentences.some((sentence, index) => topicPatterns[id].test(sentence) &&
      (qualified.test(sentence) || (/^(?:it|this|that|these|those|they|however|but|although|please note)\b/i.test(sentences[index + 1] ?? '') && qualified.test(sentences[index + 1]))))
    : !qualified.test(structured[id]);
  const ownerClaims = [...sourceFor('owners').matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(previous\s+)?(owners?|keepers?)(\s+from new)?\b/gi)].map(match => `${number(match[1])}:${match[2] ? 'previous' : 'total'}:${match[3].toLowerCase().replace(/s$/, '')}`);
  const keyClaims = [...sourceFor('keys').matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:(?:remote|original|spare)\s+){0,2}(?:keys?|key fobs?|fobs?)\b/gi)].map(match => number(match[1]));
  const serviceClaims = [...sourceFor('service').matchAll(/\((\d{1,3})\s+([a-z -]+)\s+services\)/gi)].map(match => `${Number(match[1])}:${match[2].trim().toLowerCase()}`);
  const value = (id: string) => answers.find(answer => answer.id === id)?.answer ?? '';
  const facts: VehicleSummaryFact[] = [];
  const owner = value('owners');
  if (safeTopic('owners') && new Set(ownerClaims).size <= 1 && !qualified.test(owner)) {
    const match = owner.match(/^(?:It has had )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten) (previous (?:owner|keeper)s?|recorded owners?|owners?(?: from new)?)\.?$/i);
    if (match && number(match[1]) > 0 && number(match[1]) <= 20) {
      const count = number(match[1]);
      const label = /previous/i.test(match[2]) ? `previous ${/keeper/i.test(match[2]) ? 'keeper' : 'owner'}${count === 1 ? '' : 's'}`
        : /recorded/i.test(match[2]) ? `recorded owner${count === 1 ? '' : 's'}` : `owner${count === 1 ? '' : 's'}${/from new/i.test(match[2]) ? ' from new' : ''}`;
      facts.push({ id: 'owners', text: `${count} ${label}` });
    }
  }
  const service = value('service');
  const make = car.make?.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fullHistory = new RegExp(`\\b(?:full|complete|comprehensive)\\s+(?:(?:dealer|dealership|manufacturer${make ? `|${make}` : ''})\\s+)?service history\\b`, 'i');
  if (safeTopic('service') && new Set(serviceClaims).size <= 1 && !qualified.test(service) && fullHistory.test(service)) {
    // Count named services only when the manufacturer is the supplied car make.
    const count = service.match(/\((\d{1,3})\s+([a-z -]+)\s+services\)/i);
    const named = count && count[2].trim().toLowerCase() === car.make?.trim().toLowerCase() && Number(count[1]) > 0 && Number(count[1]) <= 100;
    facts.push({ id: 'service', text: named ? `${Number(count[1])} ${car.make!.trim()} services` : 'Full service history' });
  }
  const keys = value('keys');
  if (safeTopic('keys') && new Set(keyClaims).size <= 1 && !qualified.test(keys)) {
    const match = keys.match(/^(?:It comes with )?(\d+|one|two|three|four|five|six|seven|eight|nine|ten) (?:(?:remote|original|spare) )?(?:keys?|key fobs?|fobs?)\.?$/i);
    if (match && number(match[1]) > 0 && number(match[1]) <= 10) facts.push({ id: 'keys', text: `${number(match[1])} ${number(match[1]) === 1 ? 'key' : 'keys'}` });
  }
  return facts.slice(0, 3);
}

/** Only an explicit supplied inclusion belongs beneath this heading. Optional
 * warranty details remain in the full buying information instead. */
export function vehiclePageInclusions(car: Car): string[] {
  const included = buyerInformation(car).find(item => item.label === 'Included with this car')?.value;
  const warranty = stockCardSellingPoints(car).find(point => /warranty included$/i.test(point));
  return [...new Set([warranty, included].filter((item): item is string => Boolean(item?.trim())))];
}
