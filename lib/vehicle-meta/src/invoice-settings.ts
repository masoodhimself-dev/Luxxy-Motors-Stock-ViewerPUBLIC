import type { SaleWorkspaceBranding } from './sale-workspace.ts';

export type InvoiceDetails = Partial<{
  name: string; companyName: string; companyNumber: string; vatNumber: string;
  street: string; city: string; region: string; postcode: string;
  phone: string; email: string;
}>;

export type SalesPaperwork = { saleTerms: string; reservationTerms: string; invoiceDetails?: InvoiceDetails };

export const defaultSaleTerms = `1. Vehicle details: The vehicle, agreed price, mileage, disclosed defects and included extras are recorded on this invoice and the accompanying vehicle details document.
2. Payment: Full cleared payment is required before collection or delivery. Any deposit is credited towards the purchase price.
3. Condition: The vehicle must be as described, fit for purpose and of satisfactory quality, taking account of its age, mileage and price.
4. Deposits and cancellation: Deposit conditions must be agreed in writing before payment. Any cancellation deduction must be fair, reasonable and lawful.
5. Warranty and faults: Any additional warranty is confirmed in writing. Please report faults promptly using the dealership contact details on this invoice so we can assess the issue and discuss the next steps.
6. Handover: Collection or delivery arrangements are confirmed with the buyer. The buyer must arrange insurance and vehicle tax before driving away.
7. Statutory rights: Nothing in these terms limits your statutory rights.

For qualifying distance and off-premises sales, a 14-day cancellation right applies. The applicable cancellation instructions and return arrangements will be supplied separately.`;

/** Invoice-specific details never change the public website or an issued snapshot. */
export function invoiceBranding<T extends SaleWorkspaceBranding>(branding: T, details: InvoiceDetails = {}): T {
  return {
    ...branding,
    identity: { ...branding.identity, name: details.name ?? branding.identity.name },
    contact: { ...branding.contact, phone: details.phone ?? branding.contact.phone, email: details.email ?? branding.contact.email },
    address: { ...branding.address, street: details.street ?? branding.address.street, city: details.city ?? branding.address.city, region: details.region ?? branding.address.region, postcode: details.postcode ?? branding.address.postcode },
    legal: { ...branding.legal, companyName: details.companyName ?? branding.legal.companyName, companyNumber: details.companyNumber ?? branding.legal.companyNumber, vatNumber: details.vatNumber ?? branding.legal.vatNumber },
  };
}
