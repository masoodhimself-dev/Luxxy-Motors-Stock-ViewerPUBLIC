const storageKey = 'luxxy:visitor-id';

/**
 * Anonymous, per-browser identifier. It exists so a Call or WhatsApp tap can be
 * joined to the enquiry the same person sends later — it is never used to
 * identify anybody on its own.
 */
export function getVisitorId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(storageKey);
    if (existing) return existing;
    const created =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    // Private browsing or blocked storage: the tap is still recorded, just not linked.
    return null;
  }
}
