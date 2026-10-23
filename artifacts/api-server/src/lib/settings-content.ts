/** Preserve optional onboarding content when an older settings client omits it. Explicit empty strings clear fields. */
export function preservePresentation<
  T extends { presentation?: Record<string, unknown> },
>(incoming: T, previous: unknown): T {
  const content =
    previous && typeof previous === "object" && "presentation" in previous
      ? previous.presentation
      : undefined;
  if (!content || typeof content !== "object" || Array.isArray(content))
    return incoming;
  const oldCopy = 'websiteCopy' in content ? content.websiteCopy : undefined;
  const newCopy = incoming.presentation?.websiteCopy;
  const websiteCopy = oldCopy && typeof oldCopy === 'object' && !Array.isArray(oldCopy)
    ? { ...oldCopy, ...(newCopy && typeof newCopy === 'object' ? newCopy : {}) }
    : newCopy;
  return {
    ...incoming,
    presentation: { ...content, ...incoming.presentation, ...(websiteCopy ? { websiteCopy } : {}) },
  };
}

type ReservationSettings = { enabled: boolean; depositPence: number; terms: string };

/** Older settings clients must not silently switch off or reset reservations. */
export function preserveOnlineReservation<T extends { onlineReservation?: ReservationSettings }>(incoming: T, previous: unknown): T {
  if (incoming.onlineReservation !== undefined) return incoming;
  const reservation = previous && typeof previous === "object" && "onlineReservation" in previous
    ? previous.onlineReservation
    : undefined;
  return reservation && typeof reservation === "object" && !Array.isArray(reservation)
    ? { ...incoming, onlineReservation: reservation as ReservationSettings }
    : incoming;
}

export function reservationSettingsError(settings?: ReservationSettings): string | null {
  if (settings?.enabled && !settings.terms.trim()) {
    return "Add your dealership's reservation terms before enabling Reserve car online.";
  }
  return null;
}

/** Merge brochure options so older clients do not erase a dealer's PDF design.
 * The explicit useWebsiteColour flag changes inheritance without deleting the retained custom accent.
 * Omitting the flag preserves the existing mode, including when an older client edits another field. */
export function preserveBrochure<T extends { brochure?: object }>(incoming: T, previous: unknown): T {
  const brochure = previous && typeof previous === 'object' && 'brochure' in previous ? previous.brochure : undefined;
  if (!brochure || typeof brochure !== 'object' || Array.isArray(brochure)) return incoming;
  return { ...incoming, brochure: { ...brochure, ...incoming.brochure } };
}

/** Retain the appointment policy when an older settings editor omits it. */
export function preserveTestDriveBooking<T extends { testDriveBooking?: object }>(incoming: T, previous: unknown): T {
  if (incoming.testDriveBooking !== undefined) return incoming;
  const policy = previous && typeof previous === "object" && "testDriveBooking" in previous ? previous.testDriveBooking : undefined;
  return policy && typeof policy === "object" && !Array.isArray(policy) ? { ...incoming, testDriveBooking: policy } : incoming;
}

/** Older settings clients must not erase the shared review link by omitting it. Empty explicitly clears it. */
export function preserveGoogleReviewUrl<T extends {contact: {googleReviewUrl?: string}}>(incoming:T,previous:unknown):T {
  if (incoming.contact.googleReviewUrl !== undefined) return incoming;
  const old = previous && typeof previous === 'object' && 'contact' in previous ? previous.contact : null;
  const url = old && typeof old === 'object' && 'googleReviewUrl' in old ? old.googleReviewUrl : undefined;
  return typeof url === 'string' ? {...incoming,contact:{...incoming.contact,googleReviewUrl:url}} : incoming;
}
