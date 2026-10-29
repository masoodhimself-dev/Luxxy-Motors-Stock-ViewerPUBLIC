import type { Enquiry } from "@workspace/api-client-react";
import {
  canonicalCustomerEmail,
  canonicalCustomerPhone,
} from "@workspace/vehicle-meta";
import { primaryEnquiry } from "@/lib/enquiry-groups";

export type ContinuingEnquiry = {
  primary: Enquiry;
  matchingRecord: Enquiry;
  matchedBy: Array<"phone" | "email">;
};

/** Exact contact details suggest existing cases for explicit staff review.
 * No name, suffix, fuzzy vehicle or automatic customer merging is used. */
export function findContinuingEnquiries(
  entries: readonly Enquiry[],
  contact: { phone: string; email: string; vehicleId: string },
): ContinuingEnquiry[] {
  const phone = canonicalCustomerPhone(contact.phone);
  const email = canonicalCustomerEmail(contact.email);
  if (!phone && !email) return [];
  const choices = new Map<string, ContinuingEnquiry>();
  for (const entry of entries) {
    if (contact.vehicleId && entry.vehicleId !== contact.vehicleId) continue;
    const matchedBy: ContinuingEnquiry["matchedBy"] = [];
    if (phone && phone === canonicalCustomerPhone(entry.phone))
      matchedBy.push("phone");
    if (email && email === canonicalCustomerEmail(entry.email))
      matchedBy.push("email");
    if (!matchedBy.length) continue;
    const primary = primaryEnquiry(entry, entries);
    // Missing/circular merge parents must not be treated as confirmed primary cases.
    if (
      primary.mergedIntoId ||
      primary.dealerId !== entry.dealerId ||
      !["new", "contacted"].includes(primary.status)
    )
      continue;
    const previous = choices.get(primary.id);
    if (previous)
      previous.matchedBy = [...new Set([...previous.matchedBy, ...matchedBy])];
    else choices.set(primary.id, { primary, matchingRecord: entry, matchedBy });
  }
  return [...choices.values()].sort((a, b) => {
    const timestamp = (entry: Enquiry) =>
      Date.parse(entry.updatedAt || entry.createdAt) || 0;
    return (
      timestamp(b.primary) - timestamp(a.primary) ||
      a.primary.id.localeCompare(b.primary.id)
    );
  });
}
