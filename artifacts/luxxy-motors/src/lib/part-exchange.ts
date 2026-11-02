import { vehicleRegistration } from '@/lib/utils';
import type { Car } from '@/lib/stock-context';
import type { PartExchangeMotDetailsResult } from '@/components/part-exchange-mot-details';

export type PartExchangeDetails = {
  registration: string; makeModel: string; mileage: string; condition: string;
  conditionNotes: string; keys: string; v5: string; serviceHistory: string;
  name: string; phone: string; email: string;
};

export type PartExchangeMessageOptions = { mileageEstimated?: boolean; mot?: PartExchangeMotDetailsResult['mot'] };
export function partExchangeMotSummary(mot?: PartExchangeMotDetailsResult['mot']): string | null {
  if (!mot) return null;
  if (mot.latestTestResult === 'FAILED') return 'MOT record needs checking.';
  if (!mot.dueDate) return null;
  const date = new Date(`${mot.dueDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== mot.dueDate) return null;
  const label = mot.firstTest ? 'First MOT due' : 'Recorded MOT expiry';
  return `${label}: ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' })}.`;
}

/** The editable enquiry body stays separate from the customer's contact fields. */
export function partExchangeValuationQuestion(details: Pick<PartExchangeDetails, 'makeModel' | 'registration'>, car: Car, dealerName: string) {
  const ownCar = details.makeModel.trim() || 'my car';
  const target = car.title?.trim() || [car.make, car.model].filter(Boolean).join(' ') || 'vehicle';
  return `Hi ${dealerName}, I have ${ownCar === 'my car' ? ownCar : `a ${ownCar}`} (${details.registration.trim().toUpperCase()}), and I’d like to part exchange it.\n\nI’m interested in your ${target}${vehicleRegistration(car) ? ` (${vehicleRegistration(car)})` : ''}. Could you give me a valuation?`;
}

export function buildPartExchangeMessage(details: PartExchangeDetails, car: Car, dealerName: string, options: PartExchangeMessageOptions = {}) {
  return [
    partExchangeValuationQuestion(details, car, dealerName), '',
    `${options.mileageEstimated ? 'Estimated mileage' : 'Current mileage'}: ${details.mileage ? Number(details.mileage).toLocaleString('en-GB') : 'Not entered'} miles.`,
    ...(partExchangeMotSummary(options.mot) ? [partExchangeMotSummary(options.mot)!] : []),
    ...(details.condition ? [`Condition: ${details.condition}`] : []),
    ...(details.keys ? [`Keys: ${details.keys}`] : []),
    ...(details.v5 ? [`V5C logbook: ${details.v5}`] : []),
    ...(details.serviceHistory ? [`Service history: ${details.serviceHistory}`] : []),
    ...(details.conditionNotes.trim() ? [`Other details: ${details.conditionNotes.trim()}`] : []),
  ].join('\n');
}

/** WhatsApp has no separate contact fields; show these in the reviewed preview. */
export function partExchangeWhatsAppMessage(message: string, details: PartExchangeDetails) {
  return [message.trim(), '', `Name: ${details.name.trim()}`, `Phone: ${details.phone.trim()}`, ...(details.email.trim() ? [`Email: ${details.email.trim()}`] : [])].join('\n');
}
