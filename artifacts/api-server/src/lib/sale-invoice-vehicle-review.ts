import { randomUUID } from 'node:crypto';
import { formatRegistrationPlate, isUKNumberPlate, saleCalendarDate, staffMotSummary, vehicleRegistration, type MotHistory, type SaleInvoiceVehicleReview, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { DvlaVehicleCheckError, lookupDvlaVehicle } from './dvla-vehicle-check';
import type { SaleWorkspaceReadClient } from './sale-workspace-store';

type StockVehicle = { id: string; plate: string | null; vrm: string | null; registration: string | null; make: string | null; year: number | null; colour: string | null; mileage: number | null };
type ReviewSources = {
  dvla: typeof lookupDvlaVehicle;
  mot: (registration: string) => Promise<MotHistory | null>;
  now: () => Date;
};
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const plateKey = (plate: string) => plate.toUpperCase().replace(/[\s-]/g,'');
const identityText = (value: string | null | undefined) => value?.toUpperCase().replace(/[^A-Z0-9]/g,'') ?? '';
const makeKey = (value: string | null | undefined) => {
  const make = identityText(value);
  if (make === 'VW') return 'VOLKSWAGEN';
  if (make === 'MERCEDES') return 'MERCEDESBENZ';
  return make;
};

export async function readSaleInvoiceVehicleStock(database: SaleWorkspaceReadClient, dealerId: string, vehicleId: string): Promise<StockVehicle | undefined> {
  if (!uuid.test(vehicleId)) return undefined;
  const { rows } = await database.query('SELECT id,plate,vrm,registration,make,year,colour,mileage FROM vehicles WHERE dealer_id=$1 AND id=$2::uuid',[dealerId,vehicleId]);
  return rows[0] as StockVehicle | undefined;
}

export function saleInvoiceStockIdentity(stock: StockVehicle | undefined): string {
  return stock ? JSON.stringify([stock.id,plateKey(vehicleRegistration(stock)),makeKey(stock.make),stock.year,identityText(stock.colour)]) : '';
}

export async function prepareSaleInvoiceVehicleReview(sale: SaleWorkspaceRecord, stock: StockVehicle | undefined, sources: ReviewSources): Promise<SaleInvoiceVehicleReview> {
  const savedPlate = sale.draft.registration?.trim() ?? '';
  const stockPlate = vehicleRegistration(stock);
  const review: SaleInvoiceVehicleReview = {
    id: randomUUID(), registration: formatRegistrationPlate(savedPlate || stockPlate) || savedPlate,
    checkedAt: sources.now().toISOString(), status: 'unavailable', warnings: [],
    ...(typeof stock?.mileage === 'number' && stock.mileage >= 0 ? { stockMileage: stock.mileage } : {}),
  };
  if (stockPlate && savedPlate && plateKey(stockPlate) !== plateKey(savedPlate)) {
    return { ...review, status:'needs-review', warnings:['The registration on this sale differs from the stock record. Check the plate and update the sale if needed.'] };
  }
  if (uuid.test(sale.draft.vehicleId) && !stock) {
    return { ...review, warnings:['The linked stock record is unavailable. Confirm the vehicle details manually.'] };
  }
  const registration = plateKey(review.registration);
  if (!isUKNumberPlate(registration)) return { ...review, warnings:['There is no usable UK registration to check. Confirm the vehicle details manually.'] };

  const [dvla, cached] = await Promise.allSettled([sources.dvla(registration),sources.mot(registration)]);
  const now = sources.now();
  review.checkedAt = now.toISOString();
  let identityMismatch = false;
  if (dvla.status === 'fulfilled' && dvla.value.registration === registration) {
    const { checkedAt, make, yearOfManufacture, colour, fuelType, engineCapacity } = dvla.value;
    review.dvla = { checkedAt, make, yearOfManufacture, colour, fuelType, engineCapacity };
    if (stock?.make && make && makeKey(stock.make) !== makeKey(make)) {
      identityMismatch = true;
      review.warnings.push('The DVLA make differs from the stock record. Check the vehicle before continuing.');
    }
    if (stock?.year && yearOfManufacture && stock.year !== yearOfManufacture) {
      identityMismatch = true;
      review.warnings.push('The DVLA year of manufacture differs from the stock year. Confirm the vehicle details.');
    }
    if (stock?.colour && colour && identityText(stock.colour).replace('GRAY','GREY') !== identityText(colour).replace('GRAY','GREY')) {
      identityMismatch = true;
      review.warnings.push('The DVLA colour differs from the stock record. Confirm the vehicle details.');
    }
    if (!stock?.make || !make) review.warnings.push('The vehicle make could not be matched against the stock record. Confirm the vehicle details manually.');
    review.status = identityMismatch || !stock?.make || !make ? 'needs-review' : 'checked';
  } else {
    const missing = dvla.status === 'rejected' && dvla.reason instanceof DvlaVehicleCheckError && dvla.reason.code === 'not_found';
    review.warnings.push(missing ? 'DVLA did not find this registration. Check the plate or confirm the vehicle details manually.' : 'DVLA is unavailable. Confirm the vehicle details manually.');
  }
  if (identityMismatch) return review;

  const historyAge = cached.status === 'fulfilled' && cached.value ? now.getTime() - Date.parse(cached.value.checkedAt) : NaN;
  const history = cached.status === 'fulfilled' && cached.value?.registration === registration
    && Number.isFinite(historyAge) && historyAge >= 0 && historyAge <= 86_400_000 && Array.isArray(cached.value.tests) ? cached.value : null;
  const mot = staffMotSummary(history, now);
  if (mot.state === 'failed') review.warnings.push('The latest DVSA MOT test failed. Check the current MOT before continuing.');
  if (mot.date && mot.checkedAt && history?.tests.length && (mot.state === 'current' || mot.state === 'due' || mot.state === 'expired')) {
    review.mot = { expiryDate:mot.date, source:'DVSA', checkedAt:mot.checkedAt };
  } else if (mot.state !== 'failed' && dvla.status === 'fulfilled' && dvla.value.registration === registration && dvla.value.motExpiry) {
    if (dvla.value.motStatus === 'Not valid') review.warnings.push('DVLA shows that the MOT is not valid.');
    if (dvla.value.motStatus !== 'Not valid' || dvla.value.motExpiry < saleCalendarDate(now)) {
      review.mot = { expiryDate:dvla.value.motExpiry, source:'DVLA', checkedAt:dvla.value.checkedAt };
    }
  }
  const today = saleCalendarDate(now);
  const lastReading = history?.tests.filter(test => test.mileage !== null && test.mileageUnit
    && Number.isFinite(Date.parse(test.completedDate)) && test.completedDate.slice(0,10) <= today)
    .sort((a,b) => Date.parse(b.completedDate) - Date.parse(a.completedDate))[0];
  const reading = Number(lastReading?.mileage);
  if (lastReading && Number.isFinite(reading) && reading >= 0) {
    review.lastMotMileage = { reading, unit:lastReading.mileageUnit === 'KM' ? 'km' : 'miles', recordedAt:lastReading.completedDate.slice(0,10) };
  }
  return review;
}
