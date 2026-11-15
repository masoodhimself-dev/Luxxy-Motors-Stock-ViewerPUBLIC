import {
  customerWhatsAppDraft,
  customerWhatsAppUrl,
  formatVehiclePrice,
  pickVehicleImage,
  vehicleRegistrationLabel,
  type VehicleMetaSource,
} from "@workspace/vehicle-meta";
import { z } from "zod";

type PublicNotificationVehicle = VehicleMetaSource & {
  plate?: string | null;
  vrm?: string | null;
  registration?: string | null;
  registrationBand?: string | null;
};

const recordedFact = z.string().trim().min(1).max(200).optional();
const notificationStockSchema = z.object({
  registration: recordedFact,
  variant: recordedFact,
  year: z.number().int().min(1900).max(2200).optional(),
  mileage: z.number().int().nonnegative().optional(),
  fuel: recordedFact,
  transmission: recordedFact,
  price: recordedFact,
  photoUrl: z.string().max(2048).optional(),
});
export type NotificationStock = z.infer<typeof notificationStockSchema>;

function photoUrl(candidate: string | null | undefined, origin: string | null): string | undefined {
  if (!candidate || candidate.length > 2048 || /[\\<>"\s]/u.test(candidate)) return undefined;
  if (!/^https:\/\//i.test(candidate) && !(origin && /^\/(?!\/)/.test(candidate))) {
    return undefined;
  }
  try {
    const url = new URL(candidate, origin ?? undefined);
    if (
      url.protocol === "https:" && !url.username && !url.password && !url.hash &&
      url.hostname.includes(".") && url.href.length <= 2048
    ) return url.href;
  } catch {
    // A malformed image never prevents the dealer from receiving the enquiry.
  }
  return undefined;
}

const limitFact = (value: string | null | undefined) =>
  value?.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, 200) || undefined;

export function captureNotificationStock(
  vehicle: PublicNotificationVehicle,
  excerpt: { registration: string | null; price: number | null },
  origin: string | null,
): NotificationStock {
  const { year, mileage } = vehicle;
  const currency = vehicle.currency?.trim();
  const photos = [pickVehicleImage(vehicle), ...(vehicle.images ?? []).map(image => typeof image === "string" ? image : image?.url)];
  return notificationStockSchema.parse({
    registration: limitFact(excerpt.registration || vehicleRegistrationLabel(vehicle)),
    variant: limitFact(vehicle.variant || vehicle.trim),
    year: year != null && Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : undefined,
    mileage: mileage != null && Number.isSafeInteger(mileage) && mileage >= 0 ? mileage : undefined,
    fuel: limitFact(vehicle.fuel),
    transmission: limitFact(vehicle.transmission),
    price: formatVehiclePrice(excerpt.price, currency && /^[A-Z]{3}$/i.test(currency) ? currency : "GBP") ?? undefined,
    photoUrl: photos.map(image => photoUrl(image, origin)).find(Boolean),
  });
}

/** The previous renderer still applies to any notification approved before this option existed. */
export function approvedNotificationStock(raw: unknown): NotificationStock | undefined {
  return raw === undefined ? undefined : notificationStockSchema.parse(raw);
}

export function captureNotificationWhatsApp(
  phone: string | null,
  details: Parameters<typeof customerWhatsAppDraft>[0],
): string | undefined {
  return customerWhatsAppUrl(phone ?? "", customerWhatsAppDraft(details)) ?? undefined;
}

// Approved outboxes can contain the old number-only link or the current encoded draft.
const notificationWhatsAppSchema = z.string().max(8192).regex(
  /^https:\/\/wa\.me\/[1-9]\d{7,14}(?:\?text=(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-F]{2})+)?$/,
);

export function approvedNotificationWhatsApp(raw: unknown): string | undefined {
  return raw === undefined ? undefined : notificationWhatsAppSchema.parse(raw);
}

/** A general enquiry is not a vehicle: only label a recorded car as one. */
export function notificationVehicleFacts(vehicleTitle: string | null | undefined, stock?: NotificationStock) {
  const title = vehicleTitle?.trim();
  if (!title) return [];
  const facts = [{ label: "Vehicle", value: title }];
  if (!stock) return facts;
  const variant = stock.variant && !title.toLocaleLowerCase("en-GB").includes(stock.variant.toLocaleLowerCase("en-GB"))
    ? stock.variant : undefined;
  const year = stock.year && !new RegExp(`\\b${stock.year}\\b`).test(title)
    ? String(stock.year) : undefined;
  for (const [label, value] of [
    ["Registration", stock.registration],
    ["Variant", variant],
    ["Year", year],
    ["Price at enquiry", stock.price],
    ["Mileage", stock.mileage === undefined ? undefined : `${stock.mileage.toLocaleString("en-GB")} miles`],
    ["Fuel", stock.fuel],
    ["Gearbox", stock.transmission],
  ] as const) {
    if (value) facts.push({ label, value });
  }
  return facts;
}
