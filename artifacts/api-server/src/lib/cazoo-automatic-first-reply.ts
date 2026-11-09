export const cazooFirstReplyActor = "cazoo-automatic-first-reply";

/**
 * A deliberately narrow, deterministic alternative to sending a generated draft.
 * The caller must authenticate the Cazoo delivery, check dealer/mailbox/send
 * permissions, establish that this is the first reply, and read current stock.
 * Recheck those conditions when claiming the send; this decision is not a lease.
 */
export type CazooAutomaticFirstReplyInput = {
  enabled?: boolean | null;
  isFirstReply?: boolean | null;
  customerMessage?: string | null;
  requestedRegistration?: string | null;
  dealerName?: string | null;
  matchedVehicle?: {
    title?: string | null;
    registration?: string | null;
    status?: string | null;
    /** True only after a current, unambiguous, same-dealer stock availability check. */
    availabilityConfirmed?: boolean | null;
  } | null;
};

export type CazooAutomaticFirstReplyDecision =
  | {
      action: "send";
      rule: "simple_availability_v1";
      subject: string;
      bodyText: string;
    }
  | {
      action: "draft";
      reason:
        | "disabled"
        | "not_first_reply"
        | "not_simple_availability"
        | "vehicle_unmatched"
        | "registration_unverified"
        | "vehicle_not_available"
        | "availability_unconfirmed"
        | "missing_reply_facts";
    };

// Full-message matches only. Never infer permission from keywords, sentiment,
// a model's intent classification, or an availability question inside a longer mail.
const SIMPLE_AVAILABILITY_QUESTIONS = new Set([
  "is this available",
  "is it available",
  "is the car available",
  "is this car available",
  "is the vehicle available",
  "is this vehicle available",
  "is this still available",
  "is it still available",
  "is the car still available",
  "is this car still available",
  "is the vehicle still available",
  "is this vehicle still available",
  "is this for sale",
  "is it for sale",
  "is the car for sale",
  "is this car for sale",
  "is the vehicle for sale",
  "is this vehicle for sale",
  "is this still for sale",
  "is it still for sale",
  "is the car still for sale",
  "is this car still for sale",
  "is the vehicle still for sale",
  "is this vehicle still for sale",
  "is the car still in stock",
  "is this car still in stock",
  "is the vehicle still in stock",
  "is this vehicle still in stock",
  "do you still have the car",
  "do you still have this car",
  "do you still have the vehicle",
  "do you still have this vehicle",
  "can you confirm if this is still available",
  "can you confirm if this car is still available",
  "can you confirm if this vehicle is still available",
  "could you confirm if this is still available",
  "could you confirm if this car is still available",
  "could you confirm if this vehicle is still available",
  "can you confirm whether this is still available",
  "can you confirm whether this car is still available",
  "can you confirm whether this vehicle is still available",
  "could you confirm whether this is still available",
  "could you confirm whether this car is still available",
  "could you confirm whether this vehicle is still available",
]);

function isSimpleAvailabilityQuestion(message: unknown): boolean {
  if (typeof message !== "string" || message.length > 300) return false;
  let question = message.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  // Only these neutral wrappers may be omitted. Do not remove quoted mail,
  // signatures, links or arbitrary trailing sentences to make a message match.
  question = question.replace(/^(?:hi|hello|good morning|good afternoon|good evening)(?:[,.!]\s*|\s+)/, "");
  question = question.replace(/\s+(?:thank you|thanks|many thanks|cheers)[.!]?$/, "");
  question = question.replace(/[?.!]$/, "").trim();
  question = question.replace(/^please /, "").replace(/,? please$/, "").trim();
  return SIMPLE_AVAILABILITY_QUESTIONS.has(question);
}

function registration(value: unknown): string | null {
  if (typeof value !== "string" || !/^[a-z0-9 ]{2,12}$/i.test(value)) return null;
  const normalised = value.replace(/ /g, "").toUpperCase();
  return /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{2,8}$/.test(normalised) ? normalised : null;
}

function displayName(value: unknown): string | null {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}<>]/u.test(value)) return null;
  const normalised = value.trim();
  return normalised.length > 0 && normalised.length <= 120 ? normalised : null;
}

/** Everything outside the exact safe case remains in the ordinary draft workflow. */
export function decideCazooAutomaticFirstReply(
  input?: CazooAutomaticFirstReplyInput | null,
): CazooAutomaticFirstReplyDecision {
  if (input?.enabled !== true) return { action: "draft", reason: "disabled" };
  if (input.isFirstReply !== true) return { action: "draft", reason: "not_first_reply" };
  if (!isSimpleAvailabilityQuestion(input.customerMessage))
    return { action: "draft", reason: "not_simple_availability" };
  const vehicle = input.matchedVehicle;
  if (!vehicle) return { action: "draft", reason: "vehicle_unmatched" };
  const requestedRegistration = registration(input.requestedRegistration);
  const vehicleRegistration = registration(vehicle.registration);
  if (!requestedRegistration || !vehicleRegistration || requestedRegistration !== vehicleRegistration)
    return { action: "draft", reason: "registration_unverified" };
  if (vehicle.status !== "available") return { action: "draft", reason: "vehicle_not_available" };
  if (vehicle.availabilityConfirmed !== true)
    return { action: "draft", reason: "availability_unconfirmed" };
  const vehicleTitle = displayName(vehicle.title);
  const dealerName = displayName(input.dealerName);
  if (!vehicleTitle || !dealerName) return { action: "draft", reason: "missing_reply_facts" };

  return {
    action: "send",
    rule: "simple_availability_v1",
    subject: `${vehicleTitle} (${vehicleRegistration}) - availability`,
    bodyText: [
      "Hello,",
      `Yes, the ${vehicleTitle} (${vehicleRegistration}) is currently available.`,
      "Please reply if you would like our team to arrange a viewing.",
      `Thanks,\n${dealerName}`,
    ].join("\n\n"),
  };
}
