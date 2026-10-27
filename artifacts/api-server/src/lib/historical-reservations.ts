/** Read and safely release existing historical reservations only; no new reservations are accepted. */
export type ReservationRecord = {
  id: string;
  dealerId: string;
  reference: string;
  vehicleId: string;
  vehicleTitle: string;
  /** Snapshot for new records; optional so existing saved reservations stay intact. */
  vehicleRegistration?: string | null;
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
  partExchange?: { registration: string; mileage: number };
};

export class ReservationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ReservationError";
  }
}

export function reservationView(record: ReservationRecord) {
  return {
    id: record.id,
    reference: record.reference,
    vehicleId: record.vehicleId,
    vehicleTitle: record.vehicleTitle,
    ...(record.vehicleRegistration !== undefined
      ? { vehicleRegistration: record.vehicleRegistration }
      : {}),
    depositPence: record.depositPence,
    amountReceivedPence: record.amountReceivedPence,
    paymentStatus: record.paymentStatus,
    status: record.status,
    createdAt: record.createdAt,
  };
}

/** Never let cancellation release stock that has moved into a sale or had a real payment. */
export function assertReservationCanBeCancelled(state: {
  inventoryStatus: string | undefined;
  leadStage: string;
  depositPence: number;
  hasActiveSale: boolean;
  hasCompetingReservation: boolean;
}): void {
  if (
    state.inventoryStatus !== "reserved" ||
    state.leadStage !== "reserved" ||
    state.depositPence !== 0 ||
    state.hasActiveSale ||
    state.hasCompetingReservation
  ) {
    throw new ReservationError(
      "This reservation has changed or is linked to a sale or payment. Review the lead and sale before releasing the car.",
      409,
    );
  }
}
