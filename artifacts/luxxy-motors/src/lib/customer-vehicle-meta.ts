import type { Car } from './stock-context';
import { stockRegistrationYear } from './stock-presentation';
import { vehicleRegistration, vehicleRegistrationLabel } from './utils';

/** Customers need the car's age alongside its supplied registration number. */
export function customerRegistrationDetails(car: Car): string {
  const registration = vehicleRegistration(car);
  return registration
    ? [stockRegistrationYear(car), registration].filter(Boolean).join(' · ')
    : vehicleRegistrationLabel(car);
}
