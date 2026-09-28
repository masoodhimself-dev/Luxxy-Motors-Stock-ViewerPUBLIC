export type SaleDraft = {
  id: string;
  customer: string;
  email: string;
  phone: string;
  address: string;
  vehicleId: string;
  vehicle: string;
  registration: string;
  price: string;
  partExchange: boolean;
  pxRegistration: string;
  pxDescription: string;
  pxValue: string;
  deposit: string;
  paymentMethod: string;
  notes: string;
  collection: string;
  preparation: boolean;
  documents: boolean;
  handover: boolean;
};
export const emptyDraft = (): SaleDraft => ({
  id: "DEMO-" + Date.now().toString(36).toUpperCase(),
  customer: "",
  email: "",
  phone: "",
  address: "",
  vehicleId: "",
  vehicle: "",
  registration: "",
  price: "",
  partExchange: false,
  pxRegistration: "",
  pxDescription: "",
  pxValue: "",
  deposit: "",
  paymentMethod: "Bank transfer",
  notes: "",
  collection: "",
  preparation: false,
  documents: false,
  handover: false,
});
export function pence(value: string) {
  if (!value.trim()) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return NaN;
  return Math.round(Number(value) * 100);
}
export function totals(draft: SaleDraft) {
  const price = pence(draft.price),
    allowance = draft.partExchange ? pence(draft.pxValue) : 0,
    deposit = pence(draft.deposit);
  return { price, allowance, deposit, balance: price - allowance - deposit };
}
export function errors(draft: SaleDraft): string[] {
  const amounts = totals(draft);
  return [
    !draft.customer.trim() && "Enter the customer name.",
    !draft.vehicleId && "Select a vehicle.",
    (!Number.isFinite(amounts.price) || amounts.price <= 0) &&
      "Enter a vehicle price greater than zero, with no more than two decimal places.",
    (!Number.isFinite(amounts.allowance) ||
      !Number.isFinite(amounts.deposit)) &&
      "Enter valid non-negative amounts, with no more than two decimal places.",
    amounts.balance < 0 &&
      "Part exchange and deposit cannot exceed the vehicle price.",
    draft.partExchange &&
      !draft.pxRegistration.trim() &&
      "Enter the part-exchange registration.",
  ].filter(Boolean) as string[];
}
