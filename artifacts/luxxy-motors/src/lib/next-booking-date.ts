/** A bounded, cancellable search. The selected date is still rechecked before booking. */
export async function findNextBookingDate(
  dates: string[],
  after: string,
  load: (
    date: string,
    signal: AbortSignal,
  ) => Promise<{ slots: { available: boolean }[] }>,
  signal: AbortSignal,
) {
  const candidates = dates.filter((date) => date > after).slice(0, 14);
  for (const date of candidates) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const availability = await load(date, signal);
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (availability.slots.some((slot) => slot.available)) return date;
  }
  return null;
}
