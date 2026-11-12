import { SaleWorkspaceError, type SaleWorkspaceRecord } from './sale-workspace.ts';
import { saleQueueToday } from './sale-work-queue.ts';

export type SaleInvoiceVehicleReview = {
  id: string;
  registration: string;
  checkedAt: string;
  status: 'checked' | 'needs-review' | 'unavailable';
  dvla?: { make?: string; yearOfManufacture?: number; colour?: string; fuelType?: string; engineCapacity?: number; checkedAt: string };
  mot?: { expiryDate: string; source: 'DVSA' | 'DVLA'; checkedAt: string };
  lastMotMileage?: { reading: number; unit: 'miles' | 'km'; recordedAt: string };
  stockMileage?: number;
  warnings: string[];
};
export type SaleInvoiceVehicleReviewInput = { id?: unknown; mileage?: unknown; acknowledge?: unknown; acknowledgeMot?: unknown };
export type SaleInvoiceVehicleReviewSnapshot = {
  registration: string;
  mileage: number;
  reviewedAt: string;
  verification: 'dvla' | 'manual';
  dvlaCheckedAt?: string;
  motExpiry?: string;
  motSource?: 'DVSA' | 'DVLA';
  motCheckedAt?: string;
  /** Staff confirmation of an MOT expiry warning when this invoice was issued. */
  motAcknowledgedAt?: string;
};
export type StagedSaleInvoiceVehicleReview = { review: SaleInvoiceVehicleReview; revision: number; actorId: string; stockIdentity: string };

export const saleInvoiceMileageMax = 2_000_000;
const reviewLifetimeMs = 30 * 60_000;

export function saleInvoiceMotWarning(expiryDate?: string, now = new Date()): { kind: 'expired' | 'due-today' | 'due-soon'; daysUntilExpiry: number } | undefined {
  if (typeof expiryDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || expiryDate.startsWith('0000-') || !Number.isFinite(now.getTime())) return undefined;
  const expiry = new Date(`${expiryDate}T00:00:00.000Z`);
  if (!Number.isFinite(expiry.getTime()) || expiry.toISOString().slice(0,10) !== expiryDate) return undefined;
  const londonToday = Date.parse(`${saleQueueToday(now)}T00:00:00.000Z`);
  const daysUntilExpiry = (expiry.getTime() - londonToday) / 86_400_000;
  if (daysUntilExpiry < 0) return { kind:'expired',daysUntilExpiry };
  if (daysUntilExpiry === 0) return { kind:'due-today',daysUntilExpiry };
  if (daysUntilExpiry <= 30) return { kind:'due-soon',daysUntilExpiry };
  return undefined;
}

export function requireSaleInvoiceVehicleReviewTarget(sale: SaleWorkspaceRecord, expectedRevision: unknown) {
  if (!Number.isSafeInteger(expectedRevision) || sale.revision !== expectedRevision) throw new SaleWorkspaceError('This sale changed. Reload it before checking the vehicle.', 409);
  if (sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' || sale.standaloneReturn || sale.returnReplacement?.direction === 'returned') {
    throw new SaleWorkspaceError('This sale is closed. Open its saved paperwork.', 409);
  }
  if (!sale.draft.vehicle) throw new SaleWorkspaceError('Choose and save the car before checking its details.');
}

export function confirmSaleInvoiceVehicleReview(
  sale: SaleWorkspaceRecord,
  input: unknown,
  context: { actorId?: string; now: string },
): SaleInvoiceVehicleReviewSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SaleWorkspaceError('Check and confirm the vehicle details and odometer before issuing the invoice.');
  const { id, mileage, acknowledge, acknowledgeMot } = input as SaleInvoiceVehicleReviewInput;
  if (acknowledge !== true || typeof mileage !== 'number' || !Number.isSafeInteger(mileage) || mileage < 0 || mileage > saleInvoiceMileageMax) {
    throw new SaleWorkspaceError('Enter the whole number shown on the vehicle’s odometer in miles, then confirm the details.');
  }
  const staged = sale.invoiceVehicleReview;
  const age = staged ? Date.parse(context.now) - Date.parse(staged.review.checkedAt) : NaN;
  if (!staged || staged.revision !== sale.revision || !context.actorId || staged.actorId !== context.actorId ||
    staged.review.id !== id || !Number.isFinite(age) || age < 0 || age > reviewLifetimeMs) {
    throw new SaleWorkspaceError('Check the vehicle again before issuing this invoice.', 409);
  }
  const { review } = staged;
  const motWarning = saleInvoiceMotWarning(review.mot?.expiryDate,new Date(context.now));
  if (motWarning && acknowledgeMot !== true) throw new SaleWorkspaceError('Acknowledge the MOT warning before issuing this invoice.');
  const dvlaVerified = review.status === 'checked' && Boolean(review.dvla);
  return {
    registration: review.registration, mileage, reviewedAt: context.now,
    verification: dvlaVerified ? 'dvla' : 'manual',
    ...(dvlaVerified && review.dvla ? { dvlaCheckedAt: review.dvla.checkedAt } : {}),
    ...(review.mot ? { motExpiry: review.mot.expiryDate, motSource: review.mot.source, motCheckedAt: review.mot.checkedAt } : {}),
    ...(motWarning ? { motAcknowledgedAt: context.now } : {}),
  };
}
