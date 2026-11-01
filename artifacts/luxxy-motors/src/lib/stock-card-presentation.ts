import type { Car } from './stock-context';
import { vehicleContent, prominentVehicleFeatures } from './vehicle-content';
import { vehicleHistoryFacts } from './vehicle-extra-facts';

type Point = { id: string; topic: RegExp; label: (text: string) => string | undefined };

// These are deliberately conservative summaries, not extracted advert sentences.
// A qualification, uncertainty or contrary statement removes that topic instead
// of turning a longer statement into a stronger sales promise.
const qualified = /\b(?:no|not|without|never|unavailable|absent|missing|removed|deleted|excluded|excluding|disabled|inoperative|faulty|broken|defective|intermittent|unreliable|unverified|unconfirmed|unknown|optional|preparation|prepared|prewiring|prewired|retrofitt?ing|compatible|compatibility|ready|switch|button|blind|previously|formerly|may|might|could|can|will|would|should|if|unless|needs?|requires?|repair|extra|additional|costs?|charges?|available|offered|upgrade|extend|extension|subject|terms|exclusions?|except|however|but|although|believed|check|confirm)\b|n['’]t\b|\bnon[ -]?(?:functional|functioning|working)\b|\?/i;
const unreliableClaim = /\b(?:cannot|can\s+not|cant|unable|lacks?|lacking|lost|unverifiable|unsubstantiated|unproven|uncertain|disputed|questionable|alleged|incomplete|partial)\b/i;
const conditionalClaim = /\b(?:when|provided\s+that|on\s+request|purchas(?:e|ed|ing)|only\s+(?:with|for|on|as|by|through|after|upon))\b/i;
const isQualified = (text: string) => qualified.test(text) || unreliableClaim.test(text) || conditionalClaim.test(text);
const followingQualification = /^(?:it|this|that|these|those|they|however|but|although|subject|terms|exclusions?|at(?:\s+an?)? extra|(?:an?\s+)?(?:extra|additional|costs?|charges?|optional|options?|purchase)|available|only|when|provided|on request|please note|no|not|without)\b/i;
const warrantyIncluded = /\b(?:warranty\s+(?:is\s+)?(?:included|provided|supplied)|(?:includes?|including)\s+(?:(?:a|an)\s+)?(?:(?:\d+|one|two|three|four|five|six|twelve)\s*[- ]?\s*(?:months?|years?)(?:[’']s?)?\s+)?warranty|(?:comes?|supplied|provided)\s+with\s+(?:(?:a|an)\s+)?(?:(?:\d+|one|two|three|four|five|six|twelve)\s*[- ]?\s*(?:months?|years?)(?:[’']s?)?\s+)?warranty|(?:\d+|one|two|three|four|five|six|twelve)\s*[- ]?\s*(?:months?|years?)(?:[’']s?)?\s+warranty\s+(?:is\s+)?included)\b/i;
const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, twelve: 12 };

function warrantyLabel(text: string) {
  if (!warrantyIncluded.test(text) || /\b(?:or|miles?|mileage)\b/i.test(text)) return undefined;
  const duration = text.match(/\b(\d+|one|two|three|four|five|six|twelve)\s*[- ]?\s*(months?|years?)(?:[’']s?)?\s+warranty\b|\bwarranty\s+(?:is\s+)?(?:included|provided|supplied)\s+(?:for\s+)?(\d+|one|two|three|four|five|six|twelve)\s*[- ]?\s*(months?|years?)\b/i);
  if (!duration) return 'Warranty included';
  const amount = duration[1] ?? duration[3];
  const unit = (duration[2] ?? duration[4]).toLowerCase().startsWith('year') ? 'year' : 'month';
  const value = numberWords[amount.toLowerCase()] ?? Number(amount);
  return Number.isInteger(value) && value > 0 && value <= (unit === 'year' ? 10 : 120)
    ? `${value}-${unit} warranty included`
    : undefined;
}

const points: Point[] = [
  {
    id: 'service', topic: /\b(?:servic(?:e|ed|ing)|FSH)\b/i,
    label: text => /\b(?:full\s+(?:(?:dealer(?:ship)?|manufacturer)\s+)?service\s+history|FSH)\b/i.test(text)
      ? 'Full service history'
      : /\b(?:verified\s+service\s+history|service\s+history\s+(?:is\s+)?verified)\b/i.test(text) ? 'Service history verified' : undefined,
  },
  { id: 'warranty', topic: /\bwarrant(?:y|ies)\b/i, label: warrantyLabel },
  {
    id: 'camera', topic: /\bcameras?\b/i,
    label: text => /\b(?:360(?:\s*[-°]?\s*(?:degree)?s?)?|surround)\s*[- ]\s*(?:view\s*[- ]\s*)?camera\b/i.test(text)
      ? '360° camera'
      : /\b(?:rear(?:[ -]view)?|reverse|reversing)[ -](?:parking[ -])?camera\b/i.test(text) ? 'Rear camera'
        : /\bparking[ -]camera\b/i.test(text) ? 'Parking camera' : undefined,
  },
  { id: 'heated-seats', topic: /\b(?:heated|seats?)\b/i, label: text => /\bheated\s+(?:(?:front|rear|leather|electric)\s+){0,2}seats\b/i.test(text) ? 'Heated seats' : undefined },
  { id: 'carplay', topic: /\bcarplay\b/i, label: text => /\b(?:apple\s*)?carplay\b/i.test(text) ? 'Apple CarPlay' : undefined },
  { id: 'android-auto', topic: /\bandroid\s*auto\b/i, label: text => /\bandroid\s*auto\b/i.test(text) ? 'Android Auto' : undefined },
  { id: 'panoramic', topic: /\b(?:panoramic|sunroof)\b/i, label: text => /\bpanoramic\s+(?:roof|sunroof)\b/i.test(text) ? 'Panoramic roof' : /\bsunroof\b/i.test(text) ? 'Sunroof' : undefined },
  { id: 'navigation', topic: /\b(?:navigation|sat[ -]?nav)\b/i, label: text => /\b(?:satellite\s+navigation|sat[ -]?nav)\b/i.test(text) ? 'Sat nav' : undefined },
  { id: 'parking-sensors', topic: /\bparking\s+sensors?\b/i, label: text => /\bparking\s+sensors\b/i.test(text) ? 'Parking sensors' : undefined },
  { id: 'cruise', topic: /\bcruise\s+control\b/i, label: text => /\badaptive\s+cruise\s+control\b/i.test(text) ? 'Adaptive cruise control' : /\bcruise\s+control\b/i.test(text) ? 'Cruise control' : undefined },
  { id: 'climate', topic: /\b(?:climate\s+control|air\s+conditioning)\b/i, label: text => /\bclimate\s+control\b/i.test(text) ? 'Climate control' : /\bair\s+conditioning\b/i.test(text) ? 'Air conditioning' : undefined },
  { id: 'bluetooth', topic: /\bbluetooth\b/i, label: text => /\bbluetooth\b/i.test(text) ? 'Bluetooth' : undefined },
  { id: 'isofix', topic: /\bisofix\b/i, label: text => /\bisofix\b/i.test(text) ? 'ISOFIX' : undefined },
];

function evidenceUnits(text: string): string[] {
  return text.replace(/<(?:br\s*\/?|\/p|\/div|\/li)>/gi, '\n').replace(/<[^>]*>/g, ' ')
    .split(/(?<=[.!?])\s+|[\r\n;•]+/).map(value => value.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function context(units: string[], index: number) {
  let value = units[index];
  // Keep a following "It costs extra" or "They do not work" attached to its
  // claim. Never promote a positive fragment by discarding its qualification.
  for (let next = index + 1; next < units.length && followingQualification.test(units[next]); next++) value += ` ${units[next]}`;
  return value;
}

/** Up to two supplied, compact facts. Description evidence takes precedence;
 * unknown/qualified topics do not fall back to contradictory imported data.
 * ULEZ, engine, owners and MOT belong to the existing badge row, not this list. */
export function stockCardSellingPoints(car: Car): string[] {
  const { description, features } = vehicleContent(car);
  const descriptionUnits = evidenceUnits(description ?? '');
  const service = vehicleHistoryFacts(car).find(fact => fact.label === 'Service history')?.value;
  const historyUnits = service ? [/^full$/i.test(service.trim()) ? 'Full service history' : service] : [];
  const sourceUnits = [...historyUnits, ...features];
  const blocked = new Set(points.filter(point => [...descriptionUnits.map((_, i) => context(descriptionUnits, i)), ...sourceUnits]
    .some(unit => point.topic.test(unit) && isQualified(unit))).map(point => point.id));
  const selected = new Map<string, string>();
  const collect = (units: string[]) => {
    for (const point of points) {
      if (blocked.has(point.id) || selected.has(point.id)) continue;
      const value = units.find(unit => !isQualified(unit) && point.label(unit));
      if (value) selected.set(point.id, point.label(value)!);
    }
  };
  collect(descriptionUnits.map((_, i) => context(descriptionUnits, i)));
  // Reuse the established positive-equipment filter, while retaining explicit
  // history and included-warranty entries, which are not equipment categories.
  collect([...historyUnits, ...sourceUnits.filter(unit => points.slice(0, 2).some(point => point.topic.test(unit))), ...prominentVehicleFeatures(features, features.length)]);
  return [...selected.values()].slice(0, 2);
}
