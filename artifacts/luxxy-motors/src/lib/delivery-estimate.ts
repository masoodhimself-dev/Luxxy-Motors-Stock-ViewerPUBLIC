import {
  normalisePostcode,
  validPostcodeSyntax,
} from "@workspace/vehicle-meta";

export type DeliveryEstimate = {
  postcode: string;
  roadMiles: number;
  basePricePence: number;
  pricePerMilePence: number;
  mileageChargePence: number;
  totalPence: number;
  distanceBasis: "driving";
  estimated: true;
  currency?: string;
};

type DeliverySettings = {
  identity?: { name?: string };
  address?: { postcode?: string };
  delivery?: { enabled?: boolean };
  deliveryPricing?: {
    enabled?: boolean;
    basePrice?: string;
    pricePerMile?: string;
  };
};

const safePence = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function tariffPence(value: string | undefined): number | null {
  if (!value || !/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Quotes are local to the current showroom and delivery tariff. */
export function deliveryQuoteContext(settings: DeliverySettings): string {
  return JSON.stringify([
    typeof window === "undefined" ? "" : window.location.origin,
    settings.identity?.name ?? "",
    normalisePostcode(settings.address?.postcode ?? ""),
    Boolean(settings.delivery?.enabled && settings.deliveryPricing?.enabled),
    tariffPence(settings.deliveryPricing?.basePrice),
    tariffPence(settings.deliveryPricing?.pricePerMile),
  ]);
}

export function usableDeliveryEstimate(
  value: DeliveryEstimate | null | undefined,
  postcode: string,
  pricing: DeliverySettings["deliveryPricing"],
): value is DeliveryEstimate {
  if (!value || value.distanceBasis !== "driving" || value.estimated !== true)
    return false;
  if (value.currency !== undefined && value.currency !== "GBP") return false;
  if (
    typeof value.postcode !== "string" ||
    !validPostcodeSyntax(value.postcode) ||
    normalisePostcode(value.postcode) !== normalisePostcode(postcode)
  )
    return false;
  if (!Number.isFinite(value.roadMiles) || value.roadMiles < 0) return false;
  if (
    ![
      value.basePricePence,
      value.pricePerMilePence,
      value.mileageChargePence,
      value.totalPence,
    ].every(safePence)
  )
    return false;
  if (
    !Number.isSafeInteger(value.basePricePence + value.mileageChargePence) ||
    value.basePricePence + value.mileageChargePence !== value.totalPence
  )
    return false;
  return (
    value.basePricePence === tariffPence(pricing?.basePrice) &&
    value.pricePerMilePence === tariffPence(pricing?.pricePerMile)
  );
}

/** Combine only known consumer-price bases; never infer or calculate VAT. */
export function deliveryPriceQualification(priceType?: string | null): string | null {
  const basis = priceType?.trim().replace(/\s+/g, " ") ?? "";
  if (/^(?:|(?:fixed|retail)(?: price)?|vat included|inc\.?\s*vat|incl\.?\s*vat|inclusive(?: of)? vat|including vat)$/i.test(basis)) return null;
  if (/^(?:\+\s*vat|ex(?:cl(?:uding)?)?\.?\s*vat|vat exclusive)$/i.test(basis))
    return "The advertised car price excludes VAT. This estimate covers delivery only; please confirm the full car price and VAT with the dealership.";
  return "The car’s price basis needs confirmation. This estimate covers delivery only; please confirm the full car price and any applicable VAT with the dealership.";
}

export function deliveryVehicleTotal(
  vehiclePrice: number | null | undefined,
  currency: string | null | undefined,
  deliveryPence: number,
  priceType?: string | null,
): { vehiclePence: number; totalPence: number } | null {
  if (
    currency?.trim().toUpperCase() !== "GBP" ||
    typeof vehiclePrice !== "number" ||
    !Number.isFinite(vehiclePrice) ||
    vehiclePrice <= 0 ||
    !safePence(deliveryPence) ||
    deliveryPriceQualification(priceType) !== null
  )
    return null;
  // Shift the decimal representation rather than multiplying a binary fraction.
  const [coefficient, exponent = "0"] = vehiclePrice.toString().split("e");
  const vehiclePence = Math.round(
    Number(`${coefficient}e${Number(exponent) + 2}`),
  );
  const totalPence = vehiclePence + deliveryPence;
  return safePence(vehiclePence) && safePence(totalPence)
    ? { vehiclePence, totalPence }
    : null;
}

export const deliveryMoney = (pence: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    pence / 100,
  );

export function deliveryEnquiryMessage(
  estimate: DeliveryEstimate,
  total: ReturnType<typeof deliveryVehicleTotal>,
  priceType?: string | null,
): string {
  const qualification = deliveryPriceQualification(priceType);
  if (qualification) total = null;
  const lines = [
    `I’m interested in delivery to ${normalisePostcode(estimate.postcode)} (${estimate.roadMiles.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} one-way road miles).`,
    ...(total ? [`Car price: ${deliveryMoney(total.vehiclePence)}`] : []),
    `Estimated delivery: ${deliveryMoney(estimate.totalPence)}`,
    ...(total
      ? [
          `Estimated total for car and delivery: ${deliveryMoney(total.totalPence)}`,
        ]
      : []),
    ...(qualification ? [qualification] : []),
    "Please confirm the final price and delivery availability. This is an estimate; nothing is booked or charged.",
  ];
  return lines.join("\n");
}
