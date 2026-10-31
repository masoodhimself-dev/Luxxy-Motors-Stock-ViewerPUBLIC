import type { MotHistory } from '@workspace/vehicle-meta';
import type { Car } from './stock-context';
import { vehicleRegistration } from './utils';

const numbers = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const numberWord = (value: string) => /^\d+$/.test(value) ? numbers[Number(value)] ?? value : value.toLowerCase();
const number = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten)';
const qualified = /\b(?:no|not|without|missing|lost|may|might|could|can|will|when|if|unless|sometimes|needs|requires|broken|faulty|inoperative|optional|preparation|prepared|prewired|removed|deleted|unavailable|absent|extra|additional|except|excluding|however|but|although|subject to|previously|formerly)\b|n['’]t\b/i;
const finish = (text: string) => text.trim().replace(/^[,;\s]+|[,;\s]+$/g, '').replace(/[.!?]*$/, '.');

/** Split explicit topic boundaries, never a negation away from its subject. */
function clauses(text: string) {
  return text.split(/\n\n|;\s*|\s+comes with\s+|\s+and\s+(?=(?:\d+|one|two|three)\s+(?:remote\s+)?keys?\b|MOT\b)|(?<=HPI clear)\s+(?=ULEZ\b)|\s+and\s+(?=MOT\b)/i)
    .map(value => value.trim()).filter(Boolean);
}

export function focusedVehicleAnswer(id: string, text: string): string {
  const parts = clauses(text);
  const relevant = (pattern: RegExp) => parts.filter(part => pattern.test(part)).join(' ');
  const safe = !qualified.test(text);
  if (id === 'owners' && safe) {
    const fromNew = text.match(new RegExp(`\\b(${number})\\s+owners?\\s+from new\\b`, 'i'));
    if (fromNew) return `It has had ${numberWord(fromNew[1])} ${/^(?:1|one)$/i.test(fromNew[1]) ? 'owner' : 'owners'} from new.`;
    const previous = text.match(new RegExp(`\\b(${number})\\s+previous\\s+(owners?|keepers?)\\b`, 'i'));
    if (previous) return `It has had ${numberWord(previous[1])} previous ${/^(?:1|one)$/i.test(previous[1]) ? previous[2].replace(/s$/i, '').toLowerCase() : `${previous[2].replace(/s$/i, '').toLowerCase()}s`}.`;
  }
  if (id === 'keys' && safe) {
    const keys = text.match(new RegExp(`\\b(${number})\\s+((?:(?:remote|original|spare)\\s+){0,2})(keys?|key fobs?|fobs?)\\b`, 'i'));
    if (keys) return `It comes with ${numberWord(keys[1])} ${keys[2].toLowerCase()}${keys[3].toLowerCase()}.`;
  }
  if (id === 'service' && safe) {
    const service = text.match(/\b((?:full|partial|complete|comprehensive|documented|extensive|digital)\s+(?:[\w-]+\s+){0,3}service history)\b/i);
    if (service) return `It comes with ${service[1][0].toLowerCase()}${service[1].slice(1)}.`;
  }
  if (id === 'mot' && safe) {
    const expiry = text.match(/\bMOT\s+(?:valid\s+)?(?:until|expires?\s*(?:on)?|expiry\s*(?:date)?\s*[:=-]?)\s+((?:(?:\d{1,2}(?:st|nd|rd|th)?\s+)?(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})|(?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}))/i);
    if (expiry) return `Its MOT expiry is ${expiry[1]}.`;
  }
  if (id === 'insurance' && safe && /\bHPI clear\b/i.test(text)) return 'It is HPI clear.';
  if (id === 'ulez' && safe && /\bULEZ compliant\b/i.test(text)) return 'Yes, it is ULEZ compliant.';
  if (id === 'condition' && safe && /\bdrives\s+(?:(?:amazingly|very|really)\s+)?well\b/i.test(text)) {
    return /\bsmooth engine and gearbox\b/i.test(text) ? 'It drives well, with a smooth engine and gearbox.' : 'It drives well.';
  }
  if (id === 'equipment' && safe) {
    const equipment = text.match(/\b(?:heated\s+(?:(?:front|rear|leather|electric)\s+){0,2}seats?|(?:full\s+)?panoramic\s+(?:roof|sunroof)|(?:electric\s+)?sunroof|(?:adaptive\s+)?cruise\s+control|(?:reverse|reversing|rear[- ]view|360[- ]degree)\s+camera|(?:front\s+and\s+rear\s+|rear\s+|front\s+)?parking\s+sensors?|(?:apple\s+)?carplay|android\s+auto|satellite\s+navigation|sat[- ]?nav|bluetooth|(?:dual[- ]zone\s+)?climate\s+control|air\s+conditioning|isofix)\b/gi);
    if (equipment?.length) {
      const unique = [...new Set(equipment.map(item => item.toLowerCase()))];
      return `It has ${unique.length < 2 ? unique[0] : `${unique.slice(0,-1).join(', ')} and ${unique.at(-1)}`}.`;
    }
  }
  if (id === 'condition' && safe) {
    const condition = text.split(/,\s*/).filter(part => /\b(?:condition|maintained|drives|smooth engine|smooth gearbox)\b/i.test(part));
    if (condition.length) return finish(condition.join(', '));
  }
  // Unfamiliar or qualified claims stay in their own words, with only explicit
  // unrelated clauses removed. Preserve following qualifications verbatim.
  const patterns: Record<string, RegExp> = {
    owners: /\b(?:owner|keeper)s?\b/i,
    keys: /\b(?:keys?|fobs?)\b/i,
    service: /\bservic(?:e|ed|ing)\b/i,
    mot: /\bMOT\b/i,
    insurance: /\b(?:HPI|insurance|write[ -]?off|written off|category [ABNS]|accident)\b/i,
    ulez: /\bULEZ\b/i,
  };
  const focused = patterns[id] ? relevant(patterns[id]) : text;
  // Keep qualifications such as “It costs extra” attached to the selected topic.
  if (qualified.test(text) || !focused) return text;
  return finish(focused);
}

export function usableVehicleMotHistory(car: Car, history?: MotHistory | null, now = new Date()) {
  const plate = vehicleRegistration(car)?.replace(/\s/g, '').toUpperCase();
  const checked = history ? Date.parse(history.checkedAt) : NaN;
  return Boolean(history && plate && history.registration.replace(/\s/g, '').toUpperCase() === plate
    && Number.isFinite(checked) && checked <= now.getTime() && now.getTime() - checked <= 86400000);
}
function displayDate(value: string) {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return { day, text: new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'}) };
}
/** Only the latest matching, freshly checked DVSA record can supply a pass date. */
export function vehicleMotAnswer(car: Car, history?: MotHistory | null, now = new Date()): string | null {
  if (!history || !usableVehicleMotHistory(car, history, now)) return null;
  const latest = [...history.tests].sort((a,b) => Date.parse(b.completedDate) - Date.parse(a.completedDate))[0];
  if (!latest) {
    const due = history.firstMotDueDate ? displayDate(history.firstMotDueDate) : null;
    return due && due.day > now.toISOString().slice(0, 10) ? `Its first MOT is due on ${due.text}.` : null;
  }
  const date = displayDate(latest.completedDate);
  if (!date || date.day > now.toISOString().slice(0,10)) return null;
  if (latest.result !== 'PASSED') return `Its latest recorded MOT result was a fail on ${date.text}. Check the full MOT history for details.`;
  const expiry = latest.expiryDate ? displayDate(latest.expiryDate) : null;
  return `It passed its latest recorded MOT on ${date.text}.${expiry ? ` Its MOT expiry is ${expiry.text}.` : ''}`;
}
