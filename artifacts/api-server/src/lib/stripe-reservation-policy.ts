import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { ReservationError } from './historical-reservations';

export const publicReservationDepositPence = 9_900;

const inputSchema = z.object({
  vehicleId: z.uuid().transform((value) => value.toLowerCase()),
  idempotencyKey: z.uuid().transform((value) => value.toLowerCase()),
  customerName: z.string().trim().min(2).max(120).regex(/^[^\p{Cc}]+$/u, 'Enter your name.'),
  email: z.string().trim().max(254).pipe(z.email()).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(40).transform((value) => value.replace(/[\s().\-/]/g, ''))
    .pipe(z.string().regex(/^\+?\d{7,15}$/, 'Enter a valid phone number.')),
  expectedPricePence: z.number().int().min(1).max(2_147_483_647),
  expectedDepositPence: z.number().int().positive(),
  termsAccepted: z.literal(true),
  terms: z.string().min(1).max(4_000),
}).strict();

export type PublicStripeReservationInput = z.output<typeof inputSchema>;

export function parsePublicStripeReservation(raw: unknown, terms: string) {
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) throw new ReservationError('Check your contact details and accept the reservation terms.');
  if (!terms.trim() || terms.length > 4_000) throw new ReservationError('Online reservations are unavailable. Please contact the dealership.', 503);
  const input = parsed.data;
  if (input.expectedDepositPence !== publicReservationDepositPence || input.terms !== terms) {
    throw new ReservationError('The reservation terms have changed. Refresh the page and review them again.', 409);
  }
  return input;
}

export function stripeReservationFingerprint(input: PublicStripeReservationInput) {
  // Zod returns a stable field order with the contact details already normalised.
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export type ReservableStripeVehicle = {
  id: string;
  dealer_id: string;
  source: string;
  inventory_status: string;
  source_status: string;
  archived_at: unknown;
  missing_count: number;
  currency: string;
  source_price: number | null;
  website_price_override: number | null;
  audit_metadata?: { saleWorkspaceId?: string; onlineStripeReservationId?: string; returnInspectionPending?: boolean };
  title: string | null;
  website_title_override: string | null;
  make: string | null;
  model: string | null;
  registration?: string | null;
  registration_band?: string | null;
  plate?: string | null;
  vrm?: string | null;
  year?: number | null;
};

export function assertPublicStripeVehicle(
  vehicle: ReservableStripeVehicle | undefined,
  input: PublicStripeReservationInput,
  dealerId: string,
  stockPlatform: string,
  missingHideThreshold: number,
): asserts vehicle is ReservableStripeVehicle {
  if (!vehicle || vehicle.id !== input.vehicleId || vehicle.dealer_id !== dealerId ||
      vehicle.source !== stockPlatform || vehicle.inventory_status !== 'available' ||
      vehicle.source_status !== 'live' || vehicle.archived_at != null ||
      vehicle.missing_count >= missingHideThreshold || vehicle.audit_metadata?.saleWorkspaceId ||
      vehicle.audit_metadata?.onlineStripeReservationId || vehicle.audit_metadata?.returnInspectionPending) {
    throw new ReservationError('This car is no longer available to reserve. Please contact the dealership.', 409);
  }
  const price = vehicle.website_price_override ?? vehicle.source_price;
  const pricePence = price == null ? 0 : Math.round(price * 100);
  if (vehicle.currency !== 'GBP' || !Number.isSafeInteger(pricePence) || pricePence < publicReservationDepositPence) {
    throw new ReservationError('Please contact the dealership to confirm this car’s price before reserving.', 409);
  }
  if (pricePence !== input.expectedPricePence) {
    throw new ReservationError('The price has changed. Refresh the page and review it before reserving.', 409);
  }
}
