import type { Car } from './stock-context';
import type { MotHistory } from '@workspace/vehicle-meta';
import type { DealerConfig } from '@/config/dealer';
import { vehicleDisplayTitle, formatPhoneDisplay } from './utils';
import { prioritiseVehicleFeatures } from './vehicle-content';
import { vehicleInsuranceDisclosure } from './vehicle-history';
import { vehiclePrintData } from './vehicle-print-data';
import { vehicleSheetAccent } from './vehicle-sheet-branding';
import { usableVehicleMotHistory } from './vehicle-answer-summary';
import { vehicleAnswers } from './vehicle-answers';
import { firstMotDue } from './long-mot';
import type { VehicleSheetData } from './vehicle-sheet/types';

const supplied = (value?: string) => {
  const text = value?.trim();
  return text && !/^(not supplied|not provided|unknown|n\/a|your dealership|your address|enter .+|\[.+\])$|\b(?:sample (?:address|postcode|phone|email)|example (?:road|street|address)|placeholder)\b/i.test(text) ? text : '';
};

const displayDay = (value: string) => {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day) return undefined;
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
};

/** Use the existing cache only; printing never makes another MOT request. */
function cachedMotSummary(car: Car, history?: MotHistory | null) {
  if (!history || !usableVehicleMotHistory(car, history)) return {};
  const firstDue = firstMotDue(history);
  const checked = displayDay(history.checkedAt);
  if (!checked) return {};
  if (firstDue) return { motSummary: `First MOT due ${displayDay(firstDue)}`, motCheckedDate: checked };
  // Never allow an older pass to conceal a later failed or malformed test.
  if (history.tests.some(test => !Number.isFinite(Date.parse(test.completedDate)))) return {};
  const latest = [...history.tests].sort((a, b) => Date.parse(b.completedDate) - Date.parse(a.completedDate))[0];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const expiry = latest?.expiryDate && displayDay(latest.expiryDate);
  if (latest?.result !== 'PASSED' || !displayDay(latest.completedDate) || Date.parse(latest.completedDate) > Date.now() || !expiry || latest.expiryDate!.slice(0, 10) < today) return {};
  return { motSummary: `MOT until ${expiry}`, motCheckedDate: checked };
}

/** Dealer-wide warranty policies are not a promise about an individual car. */
function confirmedInclusions(car: Car, description: string | null) {
  const answers = vehicleAnswers({ ...car, description: description || undefined });
  const uncertain = /\b(?:no|not|without|missing|lost|may|might|could|can|will|when|if|unless|needs?|requires?|optional|available|extra|additional cost|subject to confirmation)\b|n['’]t\b/i;
  const included: { label: string; value: string }[] = [];
  const qualifications: { label: string; value: string }[] = [];
  for (const id of ['warranty', 'service', 'keys']) {
    const answer = answers.find(item => item.id === id);
    if (!answer) continue;
    const row = { label: id === 'service' ? 'Service history' : id === 'keys' ? 'Keys' : 'Warranty', value: answer.answer.replace(/\s+/g, ' ').trim() };
    // A description must say the warranty is supplied, rather than merely mention it.
    const unconfirmedWarranty = id === 'warranty' && answer.source === 'description' && !/\b(?:included|includes?|comes? with|supplied|provided|as standard)\b/i.test(answer.answer);
    (uncertain.test(answer.answer) || unconfirmedWarranty ? qualifications : included).push(row);
  }
  return { included, qualifications };
}

/** Canonical shell metadata is set by the server for the current dealership. */
export function vehicleSheetLocation(id: string, doc = document) {
  const configured = doc.querySelector<HTMLMetaElement>('meta[name="luxxy-canonical-origin"][data-page-meta]')?.content;
  const origin = new URL(configured || doc.location.origin).origin;
  return { origin, url: `${origin}/vehicle/${encodeURIComponent(id)}` };
}

/** Both marketplaces use the same audited normaliser; no missing data is inferred. */
export function buildVehicleSheetData(car: Car, dealer: DealerConfig, features: string[], description: string | undefined, url: string, motHistory?: MotHistory | null): VehicleSheetData {
  const data = vehiclePrintData(car, features, description);
  const fact = (...labels: string[]) => data.facts.find(row => labels.includes(row.label))?.value || undefined;
  const email = supplied(dealer.contact.email);
  const legal = [supplied(dealer.legal.companyNumber) ? `Company no. ${dealer.legal.companyNumber}` : '', supplied(dealer.legal.vatNumber) ? `VAT no. ${dealer.legal.vatNumber}` : '', supplied(dealer.brochure?.footerNote)].filter(Boolean).join(' · ');
  // Retain complete material sentences outside the optional, shortened description.
  const material = (data.description || '').split(/(?<=[.!?])\s+|[\r\n]+/).filter(sentence => /\b(?:categor(?:y|ies)\s*[snbcd]|cat\s*[snbcd]|write[ -]?off|written off|damage[ds]?|fault[sy]?|known\s+(?:scratch|dent|issue)|defect|not roadworthy|unroadworthy|spares|repair|warning|advisory|advisories|no (?:service history|warranty|mot)|without (?:service history|warranty|mot)|not (?:included|working)|does(?:n't| not) work)\b/i.test(sentence));
  const featureConditions = data.features.filter(feature => /\b(?:faulty|broken|damaged|not working|not included|requires? repair|repair required|known (?:scratch|dent|issue)|write[ -]?off|written off|categor(?:y|ies)\s*[snbcd]|cat\s*[snbcd])\b|\bdoes(?:n't| not) work\b/i.test(feature));
  const costConditions = data.runningCosts.filter(row => /\b(?:estimat(?:e|ed)|subject to|excluding|excludes?|plus|additional|extra|fees?|charges?|conditions|terms)\b/i.test(row.value)).map(row => `${row.label}: ${row.value}`);
  const priceConditions = (data.description || '').split(/(?<=[.!?])\s+|[\r\n]+/).filter(sentence => /\b(?:plus|excludes?|excluding)\s+VAT\b|\b(?:additional|extra)\s+(?:fees?|costs?|charges?)\b|\bsubject to\s+(?:terms|conditions|fees?|charges?)\b/i.test(sentence));
  const category = vehicleInsuranceDisclosure(car, data.description || undefined);
  const disclosures = [...new Set([...data.sourceNotes, ...(category && !material.some(sentence => /\bcat(?:egory)?\s*[sn]\b/i.test(sentence)) ? [category.label] : []), ...material, ...featureConditions, ...costConditions, ...priceConditions].filter(Boolean))];
  const { included, qualifications } = confirmedInclusions(car, data.description);
  return {
    dealer: {
      name: supplied(dealer.identity.name), logoUrl: dealer.identity.logoAsset,
      accentColour: vehicleSheetAccent(dealer.identity.brandColors?.primaryHsl, dealer.brochure?.accentColour, dealer.brochure?.useWebsiteColour),
      phone: supplied(dealer.contact.phone) ? formatPhoneDisplay(dealer.contact.phone!) : undefined,
      email: email && !/^(?:demo[-@])|@demo\.|@(?:example\.(?:com|org|net)|[^@]+\.(?:test|invalid))$/i.test(email) ? email : undefined,
      address: [dealer.address?.street, dealer.address?.city, dealer.address?.region, dealer.address?.postcode].map(supplied).filter(Boolean),
      postcode: supplied(dealer.address?.postcode) || undefined,
      openingHours: dealer.hours?.filter(row => supplied(row.days) && supplied(row.times)).map(row => `${row.days.trim()} ${row.times.trim()}`).join(' · ') || undefined,
      footerNote: legal,
    },
    vehicle: {
      title: vehicleDisplayTitle(car), variant: data.variant || undefined,
      year: fact('Year'), registrationBand: fact('Registration band'), registrationNumber: fact('Registration number'),
      price: data.price || undefined, priceNote: data.priceNote,
      mileage: fact('Mileage'), fuel: fact('Fuel'), transmission: fact('Gearbox'),
      engine: fact('Engine', 'Engine size'), bodyType: fact('Body type'), colour: fact('Colour'), doors: fact('Doors'), seats: fact('Seats'),
      ...cachedMotSummary(car, motHistory),
      includedSummary: included.map(row => `${row.label}: ${row.value}`).join(' · ') || undefined,
      descriptionSummary: data.description || undefined,
      featureHighlights: prioritiseVehicleFeatures(data.features),
      // Source expiry strings are not a verified MOT status. Confirmed inclusions
      // have their own concise block; all conditions and conflicts stay visible.
      historyFacts: [...data.history.filter(row => row.label !== 'MOT expiry'
        && !(row.label === 'Availability' && /^available$/i.test(row.value))
        && !(category && row.label === 'Insurance history' && /\bcat(?:egory)?\s*[snbcd]\b/i.test(row.value))
        && ![...included, ...qualifications].some(item => item.label === row.label)), ...qualifications],
      runningCosts: data.runningCosts,
      disclosures,
      photos: data.photos.map(photo => ({ src: new URL(photo.src, window.location.origin).href, alt: photo.caption || vehicleDisplayTitle(car) })),
    },
    document: { vehiclePageUrl: url, printedDate: new Date().toLocaleDateString('en-GB') },
  };
}
