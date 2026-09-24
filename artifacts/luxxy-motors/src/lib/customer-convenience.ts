const recentKey = "luxxy.recent-vehicles.v1";
export function recentVehicles(): string[] {
  try {
    const items = JSON.parse(localStorage.getItem(recentKey) || "[]");
    return Array.isArray(items)
      ? items
          .filter(
            (item) =>
              typeof item?.id === "string" &&
              Number.isFinite(item.at) &&
              item.at <= Date.now() &&
              Date.now() - item.at < 30 * 86400000,
          )
          .slice(0, 8)
          .map((item) => item.id)
      : [];
  } catch {
    return [];
  }
}
export function rememberVehicle(id: string) {
  try {
    const previous = JSON.parse(localStorage.getItem(recentKey) || "[]");
    const items = Array.isArray(previous)
      ? previous.filter(
          (item) =>
            typeof item?.id === "string" &&
            item.id !== id &&
            Number.isFinite(item.at) &&
            item.at <= Date.now() &&
            Date.now() - item.at < 30 * 86400000,
        )
      : [];
    localStorage.setItem(
      recentKey,
      JSON.stringify([{ id, at: Date.now() }, ...items].slice(0, 8)),
    );
  } catch {
    /* Optional device-local history must not block browsing. */
  }
}
export function clearRecentVehicles() {
  try {
    localStorage.removeItem(recentKey);
  } catch {}
}
export function parseShortlist(search: string): string[] | null {
  const value = new URLSearchParams(search).get("cars");
  if (value === null) return null;
  return [
    ...new Set(
      value.split(",").filter((id) => /^[a-zA-Z0-9_-]{1,128}$/.test(id)),
    ),
  ].slice(0, 12);
}
export function shortlistUrl(ids: string[]) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/saved`, window.location.origin);
  url.searchParams.set(
    "cars",
    ids
      .filter((id) => /^[a-zA-Z0-9_-]{1,128}$/.test(id))
      .slice(0, 12)
      .join(","),
  );
  return url.href;
}
export function vehicleAvailability(status: unknown) {
  return status === "reserved"
    ? "Reserved"
    : status === "sold"
      ? "Sold"
      : status === "hidden" || status === "archived"
        ? "No longer available"
        : status === "available" || status == null
          ? "Available"
          : "Ask about availability";
}
