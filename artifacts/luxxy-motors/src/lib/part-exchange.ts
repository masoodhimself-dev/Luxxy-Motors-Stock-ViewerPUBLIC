import { vehicleRegistration } from '@/lib/utils';
import type { Car } from '@/lib/stock-context';

export type PartExchangeDetails = {
  registration: string; makeModel: string; mileage: string; condition: string;
  conditionNotes: string; keys: string; v5: string; serviceHistory: string;
  name: string; phone: string; email: string;
};

export function buildPartExchangeMessage(details: PartExchangeDetails, car: Car, dealerName: string) {
  return [
    `Hello ${dealerName}, I’d like to discuss a part exchange.`, '',
    'MY CURRENT CAR',
    `Registration: ${details.registration.trim().toUpperCase()}`,
    `Make / model: ${details.makeModel.trim()}`,
    `Mileage: ${details.mileage ? Number(details.mileage).toLocaleString('en-GB') : 'Not entered'} miles`,
    `Condition: ${details.condition}`,
    `Keys: ${details.keys}`,
    `V5C logbook: ${details.v5}`,
    `Service history: ${details.serviceHistory}`,
    `Damage / faults / other details: ${details.conditionNotes.trim() || 'Not provided'}`, '',
    'YOUR STOCK VEHICLE',
    car.title || [car.make, car.model].filter(Boolean).join(' '),
    `Stock reference: ${car.id}`,
    ...(vehicleRegistration(car) ? [`Registration: ${vehicleRegistration(car)}`] : []),
    ...(car.year ? [`Year: ${car.year}`] : []),
    ...(car.price != null ? [`Advertised price: ${car.currency || 'GBP'} ${car.price.toLocaleString('en-GB')}`] : []), '',
    'MY CONTACT DETAILS',
    `Name: ${details.name.trim()}`,
    `Phone: ${details.phone.trim()}`,
    ...(details.email.trim() ? [`Email: ${details.email.trim()}`] : []), '',
    'I will attach photos of my car in this chat. Please let me know what else you need for a valuation.',
  ].join('\n');
}
