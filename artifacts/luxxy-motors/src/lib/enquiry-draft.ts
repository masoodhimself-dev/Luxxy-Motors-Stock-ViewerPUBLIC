export type EnquiryDraft = {
  customerName: string;
  email: string;
  phone: string;
  message: string;
  preferredContact: "email" | "phone" | "whatsapp";
  hasPartExchange: boolean;
  exchange: { registration: string; mileage: string; notes: string };
};
const prefix = "luxxy.enquiry-draft.";
export const enquiryDraftKey = (vehicleId: string | undefined, type: string) =>
  `${prefix}${type}:${vehicleId || "general"}`;
export function readEnquiryDraft(key: string): EnquiryDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (
      !value ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt > Date.now() ||
      Date.now() - value.savedAt > 30 * 60_000
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    const d = value.data;
    if (
      !d ||
      !["customerName", "email", "phone", "message"].every(
        (k) => typeof d[k] === "string" && d[k].length <= 2000,
      ) ||
      !["email", "phone", "whatsapp"].includes(d.preferredContact) ||
      typeof d.hasPartExchange !== "boolean" ||
      !d.exchange ||
      !["registration", "mileage", "notes"].every(
        (k) =>
          typeof d.exchange[k] === "string" && d.exchange[k].length <= 2000,
      )
    )
      return null;
    return d;
  } catch {
    return null;
  }
}
export function saveEnquiryDraft(key: string, data: EnquiryDraft) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
    return true;
  } catch {
    return false;
  }
}
export function discardEnquiryDraft(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {}
}
