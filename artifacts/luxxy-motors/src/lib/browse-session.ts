import type { FilterState } from "@/components/filters";
const KEY = "luxxy.browse.v1";
type BrowseSession = {
  filters?: FilterState;
  showAll?: boolean;
  scrollY?: number;
  vehicleId?: string;
};
let restoreRequested = false;
export function readBrowseSession(): BrowseSession {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
export function saveBrowseSession(value: BrowseSession) {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ ...readBrowseSession(), ...value }),
    );
  } catch {
    /* Browsing remains usable when storage is blocked. */
  }
}
export function rememberStockPosition(vehicleId: string) {
  if (
    window.location.pathname.replace(/\/$/, "") ===
    import.meta.env.BASE_URL.replace(/\/$/, "") + "/stock"
  ) {
    saveBrowseSession({ scrollY: window.scrollY, vehicleId });
  }
}
export function requestBrowseRestore() {
  restoreRequested = true;
}
export function restoreBrowsePosition(skip = false) {
  if (!restoreRequested) return;
  restoreRequested = false;
  if (skip) return;
  const state = readBrowseSession();
  requestAnimationFrame(() => {
    window.scrollTo({
      top: Math.max(0, state.scrollY || 0),
      behavior: "instant",
    });
    if (state.vehicleId)
      document
        .querySelector<HTMLAnchorElement>(
          `a[data-stock-link="${CSS.escape(state.vehicleId)}"]`,
        )
        ?.focus({ preventScroll: true });
  });
}
