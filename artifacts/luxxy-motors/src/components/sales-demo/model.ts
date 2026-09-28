export type Exchange = {
  registration: string;
  description: string;
  value: string;
};
export type Payment = {
  amount: string;
  method: string;
  date: string;
  reference: string;
};
export type Adjustment = {
  description: string;
  amount: string;
  kind: "fee" | "discount";
};
export type SaleDraft = {
  exchanges?: Exchange[];
  payments?: Payment[];
  adjustments?: Adjustment[];
  customerSource?: string;
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
export const exchanges = (d: SaleDraft): Exchange[] =>
  d.exchanges ??
  (d.partExchange
    ? [
        {
          registration: d.pxRegistration,
          description: d.pxDescription,
          value: d.pxValue,
        },
      ]
    : []);
export const payments = (d: SaleDraft): Payment[] =>
  d.payments ??
  (d.deposit
    ? [{ amount: d.deposit, method: d.paymentMethod, date: "", reference: "" }]
    : []);
export function totals(draft: SaleDraft) {
  const price = pence(draft.price);
  const allowance = exchanges(draft).reduce(
    (sum, row) => sum + pence(row.value),
    0,
  );
  const deposit = payments(draft).reduce(
    (sum, row) => sum + pence(row.amount),
    0,
  );
  const adjustments = (draft.adjustments ?? []).reduce(
    (sum, row) => sum + pence(row.amount) * (row.kind === "discount" ? -1 : 1),
    0,
  );
  return {
    price,
    allowance,
    deposit,
    adjustments,
    balance: price + adjustments - allowance - deposit,
  };
}
export function errors(draft: SaleDraft): string[] {
  const amounts = totals(draft);
  return [
    !draft.customer.trim() && "Enter the customer name.",
    !draft.vehicleId && "Select a vehicle.",
    (!Number.isSafeInteger(amounts.price) || amounts.price <= 0) &&
      "Enter a valid vehicle price greater than zero.",
    Object.values(amounts).some((value) => !Number.isSafeInteger(value)) &&
      "Enter valid non-negative amounts, with no more than two decimal places.",
    amounts.balance < 0 &&
      "Part exchange, discounts and payments cannot exceed the total due.",
    exchanges(draft).length > 3 &&
      "A maximum of three part-exchange cars is allowed.",
    exchanges(draft).some((row) => !row.registration.trim()) &&
      "Enter each part-exchange registration.",
    (draft.adjustments ?? []).some(
      (row) => !row.description.trim() || !(pence(row.amount) > 0),
    ) && "Give every fee or discount a description and positive amount.",
    payments(draft).some(
      (row) =>
        !(pence(row.amount) > 0) ||
        !row.method ||
        (draft.payments !== undefined && !row.date),
    ) && "Give every payment a positive amount, method and date.",
  ].filter(Boolean) as string[];
}
