import { formatRegistrationPlate } from "./registration.ts";
import { saleHandoverStatus } from "./sale-delivery.ts";
import { saleMoney } from "./sale-operations.ts";
import { hasUnrefundedStockConflictPayment, saleCalendarDate, saleWorkspaceTotals, type SaleWorkspaceRecord } from "./sale-workspace.ts";

export type SaleCustomerUpdateKind = "handover-complete" | "handover-booked" | "sale-complete" | "deposit";
export type SaleCustomerUpdateMessage = { kind: SaleCustomerUpdateKind; label: string; subject: string; message: string };
export type SaleCustomerUpdateBinding = { saleId: string; revision: number; kind: SaleCustomerUpdateKind };

const displayDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
  timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long",
});
/** Customer wording is built only from saved sale and ledger facts. */
export function saleCustomerUpdates(sale: SaleWorkspaceRecord, dealer: string, now = new Date()): SaleCustomerUpdateMessage[] {
  const { draft, lifecycle, payments } = sale;
  if (!draft.customer.trim() || !draft.vehicle.trim() || lifecycle?.status === "released" ||
      lifecycle?.status === "returned" || sale.standaloneReturn || sale.returnReplacement?.direction === "returned") return [];

  const updates: SaleCustomerUpdateMessage[] = [];
  const name = draft.customer.trim().split(/\s+/)[0];
  const registration = formatRegistrationPlate(draft.registration);
  const car = registration ? `${draft.vehicle} (${registration})` : draft.vehicle;
  const handover = draft.fulfilment;
  const sold = Boolean(sale.completedAt && lifecycle?.status === "sold");
  const stockBlocked = Boolean(sale.stockActionBlock || hasUnrefundedStockConflictPayment(sale));
  const { balance } = saleWorkspaceTotals(draft, payments);
  const reviewBalance = Boolean(sale.corrections?.length ||
    (sale.completedAt && payments.some(payment => payment.status === "confirmed" && payment.signedAmountPence < 0)));
  const balanceLine = reviewBalance ? "We’ll confirm the balance with you separately." : balance > 0 ? `There’s ${saleMoney(balance)} left to pay.` :
    balance < 0 ? `There is ${saleMoney(-balance)} in credit on your sale.` : "Your remaining balance is £0.00.";
  const add = (kind: SaleCustomerUpdateKind, label: string, details: string[]) => updates.push({
    kind, label, subject: `${label} for your ${draft.vehicle}`,
    message: [`Hi ${name},`, "", ...details, "", "Please get in touch if you have any questions.", "", dealer].join("\n"),
  });

  if (sold && handover?.completedAt && Number.isFinite(new Date(handover.completedAt).getTime())) {
    const day = displayDate(saleCalendarDate(handover.completedAt));
    const delivery = handover.method === "delivery";
    add("handover-complete", delivery ? "Delivery complete" : "Collection complete",
      [delivery ? `Your ${car} was delivered on ${day}.` : `Your ${car} was collected on ${day}.`]);
  } else if (handover?.scheduledDate && Number.isFinite(new Date(`${handover.scheduledDate}T12:00:00Z`).getTime()) &&
      handover.scheduledDate >= saleCalendarDate(now) && !stockBlocked &&
      saleHandoverStatus(handover) === "Booked") {
    const date = displayDate(handover.scheduledDate);
    const time = handover.timeWindow.trim();
    const delivery = handover.method === "delivery";
    const lines = [`${delivery ? "Delivery" : "Collection"} for your ${car} is booked for ${date}${time ? `, ${time}` : ""}.`];
    if (delivery) lines.push(`Delivery address: ${handover.address.trim()}`);
    add("handover-booked", delivery ? "Delivery booked" : "Collection booked", lines);
  }

  if (sold) {
    add("sale-complete", "Sale confirmed", [`Thanks for buying your ${car} from us.`, balanceLine]);
  } else if (lifecycle?.status === "reserved" && !stockBlocked) {
    const confirmed = payments.filter(payment => payment.status === "confirmed");
    const deposits = new Set(confirmed.filter(payment => payment.kind === "deposit").map(payment => payment.id));
    const received = confirmed.reduce((total, payment) =>
      total + (deposits.has(payment.id) || (payment.reversesPaymentId && deposits.has(payment.reversesPaymentId)) ? payment.signedAmountPence : 0), 0);
    if (received > 0) {
      add("deposit", "Deposit received", [`We have ${saleMoney(received)} recorded towards your deposit. Your ${car} is reserved for you.`, balanceLine]);
    }
  }
  return updates;
}
