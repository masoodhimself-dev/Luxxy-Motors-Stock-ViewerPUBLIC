import type { FilterState } from "@/components/filters";
const KEY = "luxxy.browse.v1";
type BrowseSession = {
  filters?: FilterState;
  showAll?: boolean;
  scrollY?: number;
  vehicleId?: string;
  viewportWidth?: number;
  vehicleOffset?: number;
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
    const card = document.querySelector<HTMLAnchorElement>(`a[data-stock-link="${CSS.escape(vehicleId)}"]`);
    saveBrowseSession({ scrollY: window.scrollY, vehicleId, viewportWidth: window.innerWidth, vehicleOffset: card?.getBoundingClientRect().top });
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
    const link = state.vehicleId ? document.querySelector<HTMLAnchorElement>(`a[data-stock-link="${CSS.escape(state.vehicleId)}"]`) : null;
    const resized = state.viewportWidth !== undefined && state.viewportWidth !== window.innerWidth;
    const top = resized && link ? window.scrollY + link.getBoundingClientRect().top - Math.max(100, state.vehicleOffset || 100) : state.scrollY || 0;
    window.scrollTo({
      top: Math.max(0, top),
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
