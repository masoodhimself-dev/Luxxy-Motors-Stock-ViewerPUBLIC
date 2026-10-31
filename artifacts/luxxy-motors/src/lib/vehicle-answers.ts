import type { MotHistory } from '@workspace/vehicle-meta';
import { focusedVehicleAnswer, vehicleMotAnswer } from './vehicle-answer-summary';
import type { Car } from './stock-context';
import { buyerInformation } from './buyer-information';
import { vehicleContent } from './vehicle-content';
import { vehicleRunningCosts } from './vehicle-extra-facts';
import { formatMileage, formatPrice } from './utils';

export type VehicleAnswer = { id: string; question: string; answer: string; source: 'description' | 'details' | 'dealer'; href?: string; linkLabel?: string };
const topics = [
  { id: 'service', question: 'What service history comes with this car?', pattern: /\b(?:service\s+(?:history|records?|book)|serviced|servicing)\b/i, label: 'Service history' },
  { id: 'keys', question: 'How many keys come with this car?', pattern: /\b(?:\d+|one|two|three|spare|both|remote|original|no|without)\s+(?:[a-z]+\s+){0,2}(?:keys?|fobs?)\b|\b(?:keys?|fobs?)\s+(?:are|is|supplied|included|provided|available|missing|lost)\b|\b(?:keys?|fobs?)\s*[:=-]/i, label: 'Keys' },
  { id: 'owners', question: 'What is the ownership history?', pattern: /\b(?:owners?|keepers?)\b/i, label: 'Owners' },
  { id: 'mot', question: 'What MOT information is listed?', pattern: /\bM\.?O\.?T\.?\b/i, label: 'MOT expiry' },
  { id: 'equipment', question: 'What equipment does this car have?', pattern: /\b(?:heated|leather|panoramic|sunroof|cruise control|camera|parking sensors?|sat[ -]?nav|navigation|bluetooth|carplay|android auto|air conditioning|climate control|isofix)\b/i },
  { id: 'condition', question: 'What is mentioned about its condition?', pattern: /\b(?:condition|faults?|damage|scratches?|dents?|drives?|maintained|smooth engine|smooth gearbox)\b/i, label: 'Condition' },
  { id: 'ulez', question: 'Is this car ULEZ compliant?', pattern: /\b(?:ULEZ|ultra[ -]low emission zone)\b/i },
  { id: 'warranty', question: 'What warranty information is included?', pattern: /\b(?:warranty|warranties|guarantee)\b/i, label: 'Warranty' },
  { id: 'insurance', question: 'What is its insurance history?', pattern: /\b(?:HPI|write[ -]?off|written off|category [ABNS]|insurance history|accident)\b/i, label: 'Insurance history' },
  { id: 'delivery', question: 'What delivery options are mentioned?', pattern: /\bdeliver(?:y|ed)\b/i },
];

/** Compose topic-specific answers from supplied facts; never invent missing details. */
export function vehicleAnswers(car: Car, motHistory?: MotHistory | null): VehicleAnswer[] {
  const { description, features } = vehicleContent(car);
  // Keep whole sentences, including negatives, qualifications and dates. Never
  // turn “no service history” or “warranty available” into a positive promise.
  const sentences = (description ?? '').split(/(?<=[.!?])\s+(?=[A-Z0-9£])|\r?\n+/).map(value => value.trim()).filter(Boolean);
  const facts = buyerInformation(car);
  const answers: VehicleAnswer[] = [];
  for (const topic of topics) {
    const selected = new Set<number>();
    sentences.forEach((sentence, index) => {
      if (!topic.pattern.test(sentence)) return;
      selected.add(index);
      // A following qualification may refer back with “It” or “This” rather
      // than repeat the topic. Keep it with the answer, including extra costs.
      for (let next = index + 1; next < sentences.length && /^(?:it|this|that|these|those|they|please|however|but|although|subject to|terms|additional|an additional|at extra cost|charges?|exclusions?)\b/i.test(sentences[next]); next++) selected.add(next);
    });
    const matches = sentences.filter((_, index) => selected.has(index));
    if (matches.length) {
      answers.push({ id: topic.id, question: topic.question, answer: focusedVehicleAnswer(topic.id, matches.join('\n\n')), source: 'description' });
      continue;
    }
    let value = topic.label ? facts.find(fact => fact.label === topic.label || (topic.id === 'owners' && fact.label === 'Previous keepers'))?.value : null;
    if (topic.id === 'equipment' && features.length) value = features.join('\n');
    if (value?.trim()) {
      const owners = topic.id === 'owners' && /^\d+$/.test(value.trim());
      const fact = facts.find(fact => fact.label === 'Owners' || fact.label === 'Previous keepers');
      const text = owners ? `${value.trim()} ${fact?.label === 'Previous keepers' ? 'previous keepers' : 'recorded owners'}` : value.trim();
      answers.push({ id: topic.id, question: topic.question, answer: topic.id === 'equipment' ? text : focusedVehicleAnswer(topic.id, text), source: 'details' });
    }
  }
  const mot = vehicleMotAnswer(car, motHistory);
  if (mot) {
    const previous = answers.findIndex(answer => answer.id === 'mot');
    if (previous >= 0) answers.splice(previous, 1);
    answers.push({id:'mot',question:'When was its MOT and when is it due?',answer:mot,source:'details'});
  }
  const historyIds = ['owners', 'service', 'mot', 'condition', 'insurance'];
  const historyAnswers = historyIds.map(id => answers.find(answer => answer.id === id)).filter((answer): answer is VehicleAnswer => Boolean(answer));
  if (historyAnswers.length) answers.unshift({id:'history',question:'What can you tell me about this car’s history?',answer:historyAnswers.map(answer => answer.answer).join(' '),source:historyAnswers.some(answer => answer.source==='description') ? 'description' : 'details'});
  if (car.mileage != null && Number.isFinite(car.mileage) && car.mileage >= 0) answers.push({ id: 'mileage', question: 'What mileage is recorded?', answer: formatMileage(car.mileage), source: 'details' });
  else if (car.mileageText?.trim()) answers.push({ id: 'mileage', question: 'What mileage is recorded?', answer: car.mileageText.trim(), source: 'details' });
  const specification = [car.year ? `Year: ${car.year}` : '', car.fuel ? `Fuel: ${car.fuel}` : '', car.transmission ? `Transmission: ${car.transmission}` : '', car.engineSize ? `Engine: ${car.engineSize}` : '', car.doors ? `Doors: ${car.doors}` : '', car.seats ? `Seats: ${car.seats}` : '', car.colour ? `Colour: ${car.colour}` : ''].filter(Boolean);
  if (specification.length) answers.push({ id: 'specification', question: 'What are the main vehicle details?', answer: specification.join('\n'), source: 'details' });
  if (car.price != null && Number.isFinite(car.price) && car.price > 0) answers.push({ id: 'price', question: 'What is the advertised price?', answer: `${formatPrice(car.price, car.currency)}${car.priceType ? ` · ${car.priceType}` : ''}`, source: 'details' });
  const costs = vehicleRunningCosts(car);
  if (costs.length) answers.push({ id: 'costs', question: 'What running costs are listed?', answer: `${costs.map(fact => `${fact.label}: ${fact.value}`).join('\n')}\n\nActual running costs may vary. Confirm current tax and insurance costs before buying.`, source: 'details' });
  // Stable topic order within each source; description answers always come first.
  return answers.sort((a, b) => Number(a.source === 'details') - Number(b.source === 'details'));
}

export function filterVehicleAnswers(answers: VehicleAnswer[], search: string) {
  const terms = search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return answers.filter(answer => terms.every(term => `${answer.question} ${answer.answer}`.toLowerCase().includes(term)));
}
