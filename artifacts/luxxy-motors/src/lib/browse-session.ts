import { customerTestSession, readCustomerStorage, writeCustomerStorage } from "./customer-test-storage";
import type { FilterState } from "@/components/filters";
const KEY = "luxxy.browse.v1";
type BrowseSession = {
  filters?: FilterState;
  showAll?: boolean;
  visibleCount?: number;
  scrollY?: number;
  vehicleId?: string;
  viewportWidth?: number;
  vehicleOffset?: number;
};
const restoreRequests = new Set<string>();
const restoreScope = () => customerTestSession() ?? "live";
export function readBrowseSession(): BrowseSession {
  try {
    const value = JSON.parse(readCustomerStorage(sessionStorage, KEY) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}
export function saveBrowseSession(value: BrowseSession) {
  try {
    writeCustomerStorage(sessionStorage,
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
  restoreRequests.add(restoreScope());
}
export function restoreBrowsePosition(skip = false) {
  const scope = restoreScope();
  if (!restoreRequests.has(scope)) return;
  restoreRequests.delete(scope);
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

/** A local, shareable search URL; never an external return destination. */
export function browseReturnHref() {
  const params = new URLSearchParams();
  Object.entries(readBrowseSession().filters ?? {}).forEach(([key, value]) => { if (value) params.set(key, String(value)); });
  return '/stock' + (params.size ? '?' + params.toString() : '');
}
