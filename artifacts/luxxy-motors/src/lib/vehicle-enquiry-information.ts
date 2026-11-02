import type { MotHistory } from '@workspace/vehicle-meta';
import type { Car } from './stock-context';
import { firstMotDue } from './long-mot';
import { usableVehicleMotHistory } from './vehicle-answer-summary';
import { vehiclePageSummary } from './vehicle-page-summary';
import { formatMileage } from './utils';

export type VehicleEnquiryFact = { label: string; value: string };

function calendarDay(value: string): string | null {
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day ? day : null;
}

function ukToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function displayDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric',
  });
}

/** A small current-MOT fact for the enquiry panel, using the page's cached
 * record. Missing or contradictory evidence must not promote an older pass. */
export function vehicleEnquiryMot(car: Car, history?: MotHistory | null, now = new Date()): VehicleEnquiryFact | null {
  if (!Number.isFinite(now.getTime()) || !history || !Array.isArray(history.tests) ||
    typeof history.registration !== 'string' || !usableVehicleMotHistory(car, history, now)) return null;

  const today = ukToday(now);
  if (!history.tests.length) {
    const due = firstMotDue(history, now);
    return due ? { label: 'First MOT due', value: displayDay(due) } : null;
  }

  // Reject a malformed or future test rather than silently dropping it and
  // describing a different test as the latest result.
  const tests = history.tests.map(test => ({ test, day: calendarDay(test.completedDate), time: Date.parse(test.completedDate) }));
  if (tests.some(({ test, day, time }) => !day || day > today ||
    (test.completedDate.length > 10 && time > now.getTime()))) return null;
  tests.sort((a, b) => b.time - a.time);
  const latest = tests[0];
  if (latest.test.result !== 'PASSED' || tests.some(item => item.time === latest.time && item.test.result !== 'PASSED')) return null;
  const expiry = latest.test.expiryDate ? calendarDay(latest.test.expiryDate) : null;
  if (!expiry || expiry < today || expiry < latest.day!) return null;
  return { label: 'MOT expires', value: displayDay(expiry) };
}

function suppliedText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text && !/^(?:[-—–]|unknown|n\/?a|not (?:specified|available|recorded)|unspecified|tbc|tba|ask us)$/i.test(text) ? text : null;
}

/** Compact supplied vehicle facts; no guessed specification or benefits. */
export function vehicleEnquiryFacts(car: Car): VehicleEnquiryFact[] {
  const facts: VehicleEnquiryFact[] = [];
  const add = (label: string, value: unknown) => {
    const text = suppliedText(value);
    if (text) facts.push({ label, value: text });
  };
  if (Number.isInteger(car.year) && car.year! >= 1886 && car.year! <= 9999) add('Year', String(car.year));
  if (typeof car.mileage === 'number' && Number.isFinite(car.mileage) && car.mileage >= 0) add('Mileage', formatMileage(car.mileage));
  else add('Mileage', car.mileageText);
  add('Fuel', car.fuel);
  add('Transmission', car.transmission);
  add('Engine', suppliedText(car.engineSize) || (typeof car.engineCC === 'number' && Number.isFinite(car.engineCC) && car.engineCC > 0 ? `${(car.engineCC / 1000).toFixed(1)}L` : null));
  add('Body type', car.bodyType);
  add('Colour', car.colour);
  if (Number.isInteger(car.doors) && car.doors! > 0) add('Doors', String(car.doors));
  if (Number.isInteger(car.seats) && car.seats! > 0) add('Seats', String(car.seats));
  const labels = { owners: 'Owners', service: 'Service history', keys: 'Keys' };
  for (const fact of vehiclePageSummary(car)) add(labels[fact.id], fact.text);
  return facts.slice(0, 10);
}
