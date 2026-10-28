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
