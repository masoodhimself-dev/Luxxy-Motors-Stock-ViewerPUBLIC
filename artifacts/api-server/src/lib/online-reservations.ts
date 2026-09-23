import { createHash, randomUUID } from "node:crypto";
import { z } from "zod/v4";

const money = z.number().int().min(1).max(2_147_483_647);
const deposit = z.number().int().min(100).max(1_000_000);
export const onlineReservationInputSchema = z.object({
  vehicleId: z.uuid().transform((value) => value.toLowerCase()),
  idempotencyKey: z.uuid().transform((value) => value.toLowerCase()),
  customerName: z.string().trim().min(2).max(120),
  email: z.string().trim().max(254).pipe(z.email()).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(40).transform((value) => value.replace(/[\s().\-/]/g, ""))
    .pipe(z.string().regex(/^\+?\d{7,15}$/, "Please enter a valid phone number.")),
  expectedPricePence: money,
  expectedDepositPence: deposit,
  termsAccepted: z.literal(true),
  terms: z.string().trim().min(1).max(4_000),
  partExchange: z.object({
    registration: z.string().trim().toUpperCase().min(2).max(16).regex(/^[A-Z0-9 ]+$/),
    mileage: z.number().int().min(0).max(1_000_000),
  }).optional(),
}).strict();

export type OnlineReservationInput = z.output<typeof onlineReservationInputSchema>;
export type OnlineReservationSettings = { enabled: boolean; depositPence: number; terms: string };
export type ReservationContext = {
  dealerId: string;
  paymentMode?: string;
  nodeEnv?: string;
  missingHideThreshold?: number;
};
export type ReservationVehicle = {
  id: string;
  dealerId: string;
  source: string;
  inventoryStatus: string;
  sourceStatus: string;
  missingCount: number;
  currency: string;
  sourcePrice: number | null;
  websitePriceOverride: number | null;
  title: string | null;
  websiteTitleOverride?: string | null;
  make?: string | null;
  model?: string | null;
  registration?: string | null;
  plate?: string | null;
  vrm?: string | null;
};
export type ReservationRecord = {
  id: string;
  dealerId: string;
  reference: string;
  vehicleId: string;
  vehicleTitle: string;
  depositPence: number;
  amountReceivedPence: 0;
  paymentStatus: "simulated";
  status: "reserved" | "cancelled";
  createdAt: string;
  idempotencyKey: string;
  requestFingerprint: string;
  customerName: string;
  email: string;
  phone: string;
  terms: string;
  termsAccepted: true;
  expectedPricePence: number;
  partExchange?: OnlineReservationInput["partExchange"];
};

/** The SQL adapter and local fixture preview share the same decisions. */
export interface ReservationTransaction {
  lockRequest(key: string): Promise<void>;
  findByIdempotencyKey(key: string): Promise<ReservationRecord | undefined>;
  getSettings(): Promise<unknown>;
  lockVehicle(vehicleId: string): Promise<void>;
  getVehicle(vehicleId: string): Promise<ReservationVehicle | undefined>;
  hasActiveSale(vehicleId: string): Promise<boolean>;
  hasCompetingReservation(vehicleId: string, exceptLeadId?: string): Promise<boolean>;
  create(record: ReservationRecord, vehicle: ReservationVehicle): Promise<void>;
}
export interface ReservationRepository {
  transaction<T>(run: (transaction: ReservationTransaction) => Promise<T>): Promise<T>;
}

export class ReservationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ReservationError";
  }
}

export function parseOnlineReservationInput(value: unknown): OnlineReservationInput {
  const result = onlineReservationInputSchema.safeParse(value);
  if (!result.success) {
    throw new ReservationError(result.error.issues[0]?.message ?? "Please check your reservation details.");
  }
  return result.data;
}

export function onlineReservationSettings(value: unknown): OnlineReservationSettings {
  const parsed = z.object({
    enabled: z.boolean(), depositPence: deposit, terms: z.string().trim().max(4_000),
  }).safeParse(value);
  return parsed.success ? parsed.data : { enabled: false, depositPence: 10_000, terms: "" };
}

/** Simulated payments must never silently enable reservations on production. */
export function assertReservationPaymentMode(context: Pick<ReservationContext, "paymentMode" | "nodeEnv">): void {
  if (context.paymentMode !== "simulated" || context.nodeEnv === "production") {
    throw new ReservationError("Online reservations are not available while payment setup is being completed. Please contact the dealership.", 503);
  }
}

export function reservationRequestFingerprint(input: OnlineReservationInput): string {
  // Explicit property order and normalised input give retries a stable identity.
  return createHash("sha256").update(JSON.stringify({
    vehicleId: input.vehicleId, customerName: input.customerName,
    email: input.email, phone: input.phone,
    expectedPricePence: input.expectedPricePence, expectedDepositPence: input.expectedDepositPence,
    termsAccepted: input.termsAccepted, terms: input.terms,
    partExchange: input.partExchange ? { registration: input.partExchange.registration, mileage: input.partExchange.mileage } : null,
  })).digest("hex");
}

export function assertReservableVehicle(
  vehicle: ReservationVehicle | undefined,
  input: OnlineReservationInput,
  settings: OnlineReservationSettings,
  context: Pick<ReservationContext, "dealerId" | "missingHideThreshold">,
): asserts vehicle is ReservationVehicle {
  const threshold = context.missingHideThreshold ?? 2;
  if (!vehicle || vehicle.dealerId !== context.dealerId || vehicle.id !== input.vehicleId ||
      vehicle.source !== "autotrader" || vehicle.inventoryStatus !== "available" || vehicle.sourceStatus !== "live" ||
      vehicle.missingCount >= threshold) {
    throw new ReservationError("This car is no longer available to reserve. Please choose another car or contact the dealership.", 409);
  }
  const price = vehicle.websitePriceOverride ?? vehicle.sourcePrice;
  if (vehicle.currency !== "GBP" || price == null || !Number.isSafeInteger(price * 100) || price <= 0) {
    throw new ReservationError("Please contact the dealership to confirm this car’s price before reserving.", 409);
  }
  if (price * 100 !== input.expectedPricePence || settings.depositPence !== input.expectedDepositPence || settings.terms !== input.terms) {
    throw new ReservationError("The price or reservation terms have changed. Refresh this page and review them before reserving.", 409);
  }
  if (settings.depositPence > price * 100) {
    throw new ReservationError("Online reservations are unavailable for this car. Please contact the dealership.", 409);
  }
}

/** This public result deliberately omits contact details and the retry secret. */
export function reservationView(record: ReservationRecord) {
  return {
    id: record.id, reference: record.reference,
    vehicleId: record.vehicleId, vehicleTitle: record.vehicleTitle,
    depositPence: record.depositPence, amountReceivedPence: record.amountReceivedPence,
    paymentStatus: record.paymentStatus, status: record.status, createdAt: record.createdAt,
  };
}

export async function createOnlineReservation(
  rawInput: unknown,
  context: ReservationContext,
  repository: ReservationRepository,
): Promise<{ reservation: ReturnType<typeof reservationView>; replayed: boolean }> {
  const input = parseOnlineReservationInput(rawInput);
  assertReservationPaymentMode(context);
  const fingerprint = reservationRequestFingerprint(input);
  return repository.transaction(async (tx) => {
    await tx.lockRequest(input.idempotencyKey);
    const previous = await tx.findByIdempotencyKey(input.idempotencyKey);
    if (previous) {
      if (previous.requestFingerprint !== fingerprint || previous.dealerId !== context.dealerId) {
        throw new ReservationError("This reservation request has already been used with different details. Please start again.", 409);
      }
      return { reservation: reservationView(previous), replayed: true };
    }
    const settings = onlineReservationSettings(await tx.getSettings());
    if (!settings.enabled || !settings.terms) {
      throw new ReservationError("Online reservations are currently switched off. Please contact the dealership.", 409);
    }
    await tx.lockVehicle(input.vehicleId);
    const vehicle = await tx.getVehicle(input.vehicleId);
    assertReservableVehicle(vehicle, input, settings, context);
    if (await tx.hasActiveSale(input.vehicleId) || await tx.hasCompetingReservation(input.vehicleId)) {
      throw new ReservationError("This car is already being purchased or reserved. Please contact the dealership.", 409);
    }
    const id = randomUUID();
    const record: ReservationRecord = {
      id, dealerId: context.dealerId,
      reference: `RSV-${id.replace(/-/g, "").slice(0, 12).toUpperCase()}`,
      vehicleId: vehicle.id,
      vehicleTitle: vehicle.websiteTitleOverride || vehicle.title || [vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle",
      depositPence: settings.depositPence, amountReceivedPence: 0, paymentStatus: "simulated",
      status: "reserved", createdAt: new Date().toISOString(),
      idempotencyKey: input.idempotencyKey, requestFingerprint: fingerprint,
      customerName: input.customerName, email: input.email, phone: input.phone,
      terms: settings.terms, termsAccepted: true, expectedPricePence: input.expectedPricePence,
      ...(input.partExchange ? { partExchange: input.partExchange } : {}),
    };
    await tx.create(record, vehicle);
    return { reservation: reservationView(record), replayed: false };
  });
}

/** Never let cancellation release stock that has moved into a sale or had a real payment. */
export function assertReservationCanBeCancelled(state: {
  inventoryStatus: string | undefined;
  leadStage: string;
  depositPence: number;
  hasActiveSale: boolean;
  hasCompetingReservation: boolean;
}): void {
  if (state.inventoryStatus !== "reserved" || state.leadStage !== "reserved" ||
      state.depositPence !== 0 || state.hasActiveSale || state.hasCompetingReservation) {
    throw new ReservationError("This reservation has changed or is linked to a sale or payment. Review the lead and sale before releasing the car.", 409);
  }
}
