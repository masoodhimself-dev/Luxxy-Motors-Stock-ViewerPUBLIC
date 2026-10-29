import type { Car } from './stock-context';
const headings = new Set(['please note', 'audio and communications', 'drivers assistance', 'driver assistance', 'exterior', 'illumination', 'interior', 'performance', 'safety and security', 'valuable features', 'rare features', 'added extras']);
const clean = (value: string) => value.replace(/\u0092/g, '’').trim();

/** Add readable paragraphs without rewriting or dropping the seller's wording. */
export function vehicleDescriptionParagraphs(description: string): string[] {
  return description.trim().split(/\n\s*\n/).flatMap(block => {
    const sentences = block.trim().split(/(?<=[.!?])\s+(?=[A-Z])/);
    const paragraphs: string[] = [];
    let paragraph = '';
    for (const sentence of sentences) {
      if (paragraph.length >= 320) {
        paragraphs.push(paragraph);
        paragraph = '';
      }
      paragraph += `${paragraph ? ' ' : ''}${sentence}`;
    }
    if (paragraph) paragraphs.push(paragraph);
    return paragraphs;
  });
}

const usefulEquipment = [
  /\b(?:panoramic|sunroof)\b/i,
  /\b(?:apple\s*carplay|carplay|android\s*auto)\b/i,
  /\b(?:parking\s+(?:sensors?|camera)|revers(?:e|ing)\s+camera|rear[ -]?(?:view[ -]?)?camera|(?:360(?:[ -]*degrees?|°)?|surround)[ -]+(?:view[ -]+)?camera)\b/i,
  /\b(?:adaptive\s+)?cruise\s+control\b/i,
  /\b(?:climate\s+control|air\s+conditioning|heated\s+(?:(?:front|rear)\s+)?seats?)\b/i,
  /\b(?:navigation|sat(?:ellite)?[ -]?nav|bluetooth)\b/i,
  /\bisofix\b/i,
];

/** Reorder only supplied equipment; preserve every entry and its exact wording. */
export function prioritiseVehicleFeatures(features: string[]): string[] {
  const rank = (feature: string) => {
    // A missing or removed feature must never become a prominent selling point.
    if (/\b(?:no|not|without|unavailable|absent|removed|deleted|missing|excluded|disabled|inoperative|faulty|broken)\b|\b(?:isn['’]?t|doesn['’]?t|non[ -]?(?:functional|functioning|working))\b/i.test(feature)) {
      return usefulEquipment.length;
    }
    const match = usefulEquipment.findIndex(pattern => pattern.test(feature));
    return match < 0 ? usefulEquipment.length : match;
  };
  return features
    .map((feature, index) => ({ feature, index, rank: rank(feature) }))
    .sort((first, second) => first.rank - second.rank || first.index - second.index)
    .map(({ feature }) => feature);
}

/** Highlights must be positively stated equipment, not possibilities or preparation. */
export function prominentVehicleFeatures(features: string[], limit = 6): string[] {
  return prioritiseVehicleFeatures(features).filter(feature =>
    !/\b(?:no|not|without|unavailable|absent|removed|deleted|missing|excluded|disabled|inoperative|faulty|broken|optional|preparation|prewiring)\b|\b(?:isn['’]?t|doesn['’]?t|non[ -]?(?:functional|functioning|working))\b/i.test(feature)
    && usefulEquipment.some(pattern => pattern.test(feature))
  ).slice(0, limit);
}

export function groupVehicleEquipment(features: string[]) {
  const categories = [
    ['Parking & manoeuvring', /parking|revers(?:e|ing)|camera|park assist/i],
    ['Entertainment & connectivity', /audio|radio|speaker|sound system|bluetooth|carplay|android|navigation|sat.?nav|usb|media|telephone|infotainment/i],
    ['Safety & driver assistance', /airbag|brak|isofix|stability|traction|collision|lane|blind spot|cruise|speed limit|alarm|immobiliser|seat.?belt|tyre pressure/i],
    ['Comfort & interior', /seat|climate|air.?conditioning|sunroof|panoramic|upholstery|leather|steering|interior|armrest|cup holder|heated|window|keyless/i],
    ['Exterior & styling', /alloy|wheel|paint|mirror|light|lamp|roof|trim|spoiler|exterior|bumper/i],
  ] as const;
  const grouped = new Map<string, string[]>();
  for (const feature of features) {
    const label = categories.find(([, pattern]) => pattern.test(feature))?.[0] || 'Other equipment';
    grouped.set(label, [...(grouped.get(label) || []), feature]);
  }
  return [...categories.map(([label]) => label), 'Other equipment'].filter(label => grouped.has(label)).map(label => ({ label, features: grouped.get(label)! }));
}

export function vehicleContent(car: Car) {
  const description = [car.description, car.specifications?.description, car.sourceExtras?.description, car.sourceExtras?.advertDescription]
    .find((value): value is string => typeof value === 'string' && !!value.trim());
  const sources = [car.features, car.specifications?.features, car.sourceExtras?.features, car.sourceExtras?.featureList];
  let features: string[] = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    const seen = new Set<string>();
    features = source.filter((value): value is string => typeof value === 'string').map(clean).filter(value => {
      const key = value.toLowerCase().replace(/:$/, '').trim();
      if (!key || headings.has(key) || seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (features.length) break;
  }
  return {description: description ? clean(description) : undefined, features};
}
