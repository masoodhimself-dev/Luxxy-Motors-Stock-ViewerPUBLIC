/** Private settings stay in memory. No form data is copied into browser storage or history. */
const dirtySelector =
  '[data-settings-dirty="true"], [data-message-dirty="true"]';
const positionKey = "__luxxySettingsHistoryPositionV1";
let approvedNavigation = false;
let mountedGuard: { users: number; remove: () => void } | undefined;
const hasUnsavedSettings = (root: ParentNode = document) =>
  Boolean(root.querySelector(dirtySelector));
export function confirmSettingsNavigation(
  root: ParentNode = document,
): boolean {
  if (!hasUnsavedSettings(root)) return true;
  approvedNavigation = window.confirm(
    root.querySelector('[data-message-dirty="true"]')
      ? "You have an unsaved customer message or note. Leave and discard those changes?"
      : "You have unsaved settings. Leave and discard those changes?",
  );
  return approvedNavigation;
}
/** Guard router links and browser Back/Forward before Wouter receives the change.
 * History stores only a numeric position; cancelled traversal returns to the
 * existing entry, so the mounted private editor and its text are preserved. */
export function installSettingsNavigationGuard(): () => void {
  if (mountedGuard) {
    mountedGuard.users++;
    return () => release();
  }
  const originalPush = history.pushState,
    originalReplace = history.replaceState;
  const currentUrl = () => location.pathname + location.search + location.hash;
  const position = (state: unknown): number | undefined => {
    const value =
      state && typeof state === "object"
        ? (state as Record<string, unknown>)[positionKey]
        : undefined;
    return typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : undefined;
  };
  const withPosition = (state: unknown, index: number) => ({
    ...(state && typeof state === "object" ? state : {}),
    [positionKey]: index,
  });
  let index = position(history.state) ?? 0;
  let accepted = {
    index,
    url: currentUrl(),
    state: withPosition(history.state, index),
  };
  let restoring = false;
  originalReplace.call(history, accepted.state, "", accepted.url);
  const allow = (url: string) => {
    if (url === accepted.url || !hasUnsavedSettings()) {
      approvedNavigation = false;
      return true;
    }
    if (approvedNavigation) {
      approvedNavigation = false;
      return true;
    }
    const result = confirmSettingsNavigation();
    approvedNavigation = false;
    return result;
  };
  const push: History["pushState"] = function (state, title, url) {
    const target = new URL(url ?? location.href, location.href);
    if (!allow(target.pathname + target.search + target.hash)) return;
    const next = withPosition(state, ++index);
    accepted = {
      index,
      url: target.pathname + target.search + target.hash,
      state: next,
    };
    originalPush.call(history, next, title, url);
  };
  const replace: History["replaceState"] = function (state, title, url) {
    const target = new URL(url ?? location.href, location.href);
    if (!allow(target.pathname + target.search + target.hash)) return;
    const next = withPosition(state, index);
    accepted = {
      index,
      url: target.pathname + target.search + target.hash,
      state: next,
    };
    originalReplace.call(history, next, title, url);
  };
  const pop = (event: PopStateEvent) => {
    if (restoring) {
      restoring = false;
      event.stopImmediatePropagation();
      return;
    }
    const targetIndex = position(event.state);
    if (allow(currentUrl())) {
      index = targetIndex ?? index;
      accepted = {
        index,
        url: currentUrl(),
        state: withPosition(event.state, index),
      };
      return;
    }
    event.stopImmediatePropagation();
    if (targetIndex !== undefined && targetIndex !== accepted.index) {
      restoring = true;
      history.go(accepted.index - targetIndex);
    } else {
      // Entries created before the portal has loaded have no known position.
      // Restore the current URL without unmounting or serialising the editor.
      originalPush.call(history, accepted.state, "", accepted.url);
    }
  };
  const unload = (event: BeforeUnloadEvent) => {
    if (hasUnsavedSettings()) {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  history.pushState = push;
  history.replaceState = replace;
  window.addEventListener("popstate", pop, true);
  window.addEventListener("beforeunload", unload);
  mountedGuard = {
    users: 1,
    remove: () => {
      window.removeEventListener("popstate", pop, true);
      window.removeEventListener("beforeunload", unload);
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace)
        history.replaceState = originalReplace;
      approvedNavigation = false;
    },
  };
  return () => release();
}
function release() {
  if (mountedGuard && --mountedGuard.users === 0) {
    mountedGuard.remove();
    mountedGuard = undefined;
  }
}
