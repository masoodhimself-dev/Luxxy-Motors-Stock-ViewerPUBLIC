/** Preserve optional onboarding content when an older settings client omits it. Explicit empty strings clear fields. */
export function preservePresentation<
  T extends { presentation?: Record<string, string | boolean | undefined> },
>(incoming: T, previous: unknown): T {
  const content =
    previous && typeof previous === "object" && "presentation" in previous
      ? previous.presentation
      : undefined;
  if (!content || typeof content !== "object" || Array.isArray(content))
    return incoming;
  return {
    ...incoming,
    presentation: { ...content, ...incoming.presentation },
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

/** Merge brochure options so older clients do not erase a dealer's PDF design. */
export function preserveBrochure<T extends { brochure?: object }>(incoming: T, previous: unknown): T {
  const brochure = previous && typeof previous === 'object' && 'brochure' in previous ? previous.brochure : undefined;
  if (!brochure || typeof brochure !== 'object' || Array.isArray(brochure)) return incoming;
  return { ...incoming, brochure: { ...brochure, ...incoming.brochure } };
}
