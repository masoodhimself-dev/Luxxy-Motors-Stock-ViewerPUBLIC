import type { SaleWorkspaceBranding } from "./sale-workspace.ts";

export type InvoiceDetails = Partial<{
  name: string;
  companyName: string;
  companyNumber: string;
  vatNumber: string;
  street: string;
  city: string;
  region: string;
  postcode: string;
  phone: string;
  email: string;
}>;

export type SalesPaperwork = {
  saleTerms: string;
  reservationTerms: string;
  invoiceDetails?: InvoiceDetails;
};

export const defaultSaleTerms = `The vehicle, price and disclosed condition are recorded on this invoice. Full cleared payment is required before handover; deposits count towards the price. Deposit and cancellation conditions must be agreed in writing and be fair and lawful. Any warranty is confirmed separately. Contact us promptly about faults. Arrange insurance and vehicle tax before driving away. Nothing in these terms limits your statutory rights. Qualifying distance and off-premises sales have a 14-day cancellation right; instructions are supplied separately.`;

/** Invoice-specific details never change the public website or an issued snapshot. */
export function invoiceSellerBranding<T extends SaleWorkspaceBranding>(
  branding: T,
  details: InvoiceDetails = {},
): T {
  return {
    ...branding,
    identity: {
      ...branding.identity,
      name: details.name ?? branding.identity.name,
    },
    contact: {
      ...branding.contact,
      phone: details.phone ?? branding.contact.phone,
      email: details.email ?? branding.contact.email,
    },
    address: {
      ...branding.address,
      street: details.street ?? branding.address.street,
      city: details.city ?? branding.address.city,
      region: details.region ?? branding.address.region,
      postcode: details.postcode ?? branding.address.postcode,
    },
    legal: {
      ...branding.legal,
      companyName: details.companyName ?? branding.legal.companyName,
      companyNumber: details.companyNumber ?? branding.legal.companyNumber,
      vatNumber: details.vatNumber ?? branding.legal.vatNumber,
    },
  };
}
