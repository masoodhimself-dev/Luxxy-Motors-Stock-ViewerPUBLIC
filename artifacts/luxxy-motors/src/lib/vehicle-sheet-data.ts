import type { Car } from './stock-context';
import type { DealerConfig } from '@/config/dealer';
import { vehicleDisplayTitle, formatPhoneDisplay } from './utils';
import { prioritiseVehicleFeatures } from './vehicle-content';
import { vehicleInsuranceDisclosure } from './vehicle-history';
import { vehiclePrintData } from './vehicle-print-data';
import { vehicleSheetAccent } from './vehicle-sheet-branding';
import type { VehicleSheetData } from './vehicle-sheet/types';

const supplied = (value?: string) => {
  const text = value?.trim();
  return text && !/^(not supplied|not provided|unknown|n\/a|your dealership|your address|enter .+|\[.+\])$|\b(?:sample (?:address|postcode|phone|email)|example (?:road|street|address)|placeholder)\b/i.test(text) ? text : '';
};

/** Canonical shell metadata is set by the server for the current dealership. */
export function vehicleSheetLocation(id: string, doc = document) {
  const configured = doc.querySelector<HTMLMetaElement>('meta[name="luxxy-canonical-origin"][data-page-meta]')?.content;
  const origin = new URL(configured || doc.location.origin).origin;
  return { origin, url: `${origin}/vehicle/${encodeURIComponent(id)}` };
}

/** Both marketplaces use the same audited normaliser; no missing data is inferred. */
export function buildVehicleSheetData(car: Car, dealer: DealerConfig, features: string[], description: string | undefined, url: string): VehicleSheetData {
  const data = vehiclePrintData(car, features, description);
  const fact = (...labels: string[]) => data.facts.find(row => labels.includes(row.label))?.value || undefined;
  const email = supplied(dealer.contact.email);
  const legal = [supplied(dealer.legal.companyNumber) ? `Company no. ${dealer.legal.companyNumber}` : '', supplied(dealer.legal.vatNumber) ? `VAT no. ${dealer.legal.vatNumber}` : '', supplied(dealer.brochure?.footerNote)].filter(Boolean).join(' · ');
  // Retain complete material sentences outside the optional, shortened description.
  const material = (data.description || '').split(/(?<=[.!?])\s+|[\r\n]+/).filter(sentence => /\b(?:categor(?:y|ies)\s*[snbcd]|cat\s*[snbcd]|write[ -]?off|written off|damage[ds]?|fault[sy]?|known\s+(?:scratch|dent|issue)|defect|not roadworthy|unroadworthy|spares|repair|warning|advisory|advisories|no (?:service history|warranty|mot)|without (?:service history|warranty|mot)|not (?:included|working)|does(?:n't| not) work)\b/i.test(sentence));
  const category = vehicleInsuranceDisclosure(car, data.description || undefined);
  const disclosures = [...new Set([...data.sourceNotes, ...(category && !material.some(sentence => /\bcat(?:egory)?\s*[sn]\b/i.test(sentence)) ? [category.label] : []), ...material].filter(Boolean))];
  return {
    dealer: {
      name: supplied(dealer.identity.name), logoUrl: dealer.identity.logoAsset,
      accentColour: vehicleSheetAccent(dealer.identity.brandColors?.primaryHsl, dealer.brochure?.accentColour, dealer.brochure?.useWebsiteColour),
      phone: supplied(dealer.contact.phone) ? formatPhoneDisplay(dealer.contact.phone!) : undefined,
      email: email && !/^(?:demo[-@])|@demo\.|@(?:example\.(?:com|org|net)|[^@]+\.(?:test|invalid))$/i.test(email) ? email : undefined,
      address: [dealer.address?.street, dealer.address?.city, dealer.address?.region, dealer.address?.postcode].map(supplied).filter(Boolean), footerNote: legal,
    },
    vehicle: {
      title: vehicleDisplayTitle(car), variant: data.variant || undefined,
      year: fact('Year'), registrationBand: fact('Registration band'), registrationNumber: fact('Registration number'),
      price: data.price || undefined, priceNote: data.priceNote,
      mileage: fact('Mileage'), fuel: fact('Fuel'), transmission: fact('Gearbox'),
      engine: fact('Engine', 'Engine size'), bodyType: fact('Body type'), colour: fact('Colour'), doors: fact('Doors'), seats: fact('Seats'),
      descriptionSummary: data.description || undefined,
      featureHighlights: prioritiseVehicleFeatures(data.features),
      historyFacts: data.history,
      runningCosts: data.runningCosts,
      disclosures,
      photos: data.photos.map(photo => ({ src: new URL(photo.src, window.location.origin).href, alt: photo.caption || vehicleDisplayTitle(car) })),
    },
    document: { vehiclePageUrl: url, printedDate: new Date().toLocaleDateString('en-GB') },
  };
}
