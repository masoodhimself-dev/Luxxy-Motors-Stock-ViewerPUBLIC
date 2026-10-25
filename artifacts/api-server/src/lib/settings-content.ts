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

/** Validate the public link fields too: API clients must not bypass the editor's URL checks. */
export function publicSettingsLinkError(settings: Record<string, unknown>): string | null {
  const groups: Array<[string, string[], boolean]> = [
    ['identity', ['logoAsset'], true], ['address', ['mapsUrl'], false],
    ['legal', ['termsUrl', 'privacyUrl', 'cookieUrl'], true],
    ['social', ['instagram', 'facebook', 'twitter'], false],
  ];
  for (const [name, fields, local] of groups) {
    const group = settings[name];
    if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
    for (const field of fields) {
      const value = (group as Record<string, unknown>)[field];
      if (value === undefined || value === '') continue;
      if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f\\]/.test(value)) return `Use a valid HTTP or HTTPS address for ${name}.${field}, or leave it empty.`;
      if (local && /^\/(?!\/)/.test(value)) continue;
      // Existing embedded raster logos remain supported. SVG/HTML data URLs cannot be published.
      if (name === 'identity' && /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) continue;
      try {
        const url = new URL(value);
        if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) continue;
      } catch { /* Fall through to a human-readable validation message. */ }
      return `Use a valid HTTP or HTTPS address for ${name}.${field}, or leave it empty.`;
    }
  }
  const presentation = settings.presentation;
  if (presentation && typeof presentation === 'object' && !Array.isArray(presentation)) {
    for (const [field, value] of Object.entries(presentation)) {
      if (!field.endsWith('Url') || value === undefined || value === '') continue;
      if (typeof value === 'string' && !/[\s\u0000-\u001f\u007f\\]/.test(value)) {
        try {
          const url = new URL(value);
          if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) continue;
        } catch { /* Invalid URL is rejected below. */ }
      }
      return `Use a valid HTTPS address for presentation.${field}, or leave it empty.`;
    }
  }
  return null;
}
