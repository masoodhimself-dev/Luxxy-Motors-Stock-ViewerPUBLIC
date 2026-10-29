import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import {
  confirmSettingsNavigation,
  installSettingsNavigationGuard,
} from "./settings-navigation";
let remove: (() => void) | undefined;
function dirty() {
  const form = document.createElement("section");
  form.dataset.settingsDirty = "true";
  form.textContent = "Private unsaved text";
  document.body.append(form);
  return form;
}
afterEach(() => {
  remove?.();
  remove = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  history.replaceState({}, "", "/");
});
it("blocks unguarded router changes and never stores private form text in history", () => {
  history.replaceState({ existing: "keep" }, "", "/portal?section=settings");
  remove = installSettingsNavigationGuard();
  dirty();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  history.pushState({}, "", "/portal?section=sales");
  expect(location.search).toBe("?section=settings");
  expect(confirm).toHaveBeenCalledOnce();
  expect(JSON.stringify(history.state)).not.toContain("Private unsaved text");
  expect(history.state.existing).toBe("keep");
  confirm.mockReturnValue(true);
  expect(confirmSettingsNavigation()).toBe(true);
  history.pushState({}, "", "/portal?section=sales");
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(location.search).toBe("?section=sales");
});
it("cancelled Back preserves the mounted editor and current history entry; approved Back leaves", async () => {
  history.replaceState({}, "", "/portal?section=notifications");
  remove = installSettingsNavigationGuard();
  history.pushState({}, "", "/portal?section=settings");
  const form = dirty();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  let routerChanges = 0;
  const router = () => routerChanges++;
  window.addEventListener("popstate", router);
  try {
    history.back();
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(location.search).toBe("?section=settings"));
    expect(form.isConnected).toBe(true);
    expect(form.textContent).toBe("Private unsaved text");
    expect(routerChanges).toBe(0);
    confirm.mockReturnValue(true);
    history.back();
    await waitFor(() => expect(location.search).toBe("?section=notifications"));
    await waitFor(() => expect(routerChanges).toBe(1));
  } finally {
    window.removeEventListener("popstate", router);
  }
});
it("cancelled Forward returns to the current settings entry without exposing editor contents", async () => {
  history.replaceState({}, "", "/portal?section=notifications");
  remove = installSettingsNavigationGuard();
  history.pushState({}, "", "/portal?section=settings");
  history.pushState({}, "", "/portal?section=sales");
  history.back();
  await waitFor(() => expect(location.search).toBe("?section=settings"));
  dirty();
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  history.forward();
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  await waitFor(() => expect(location.search).toBe("?section=settings"));
  expect(document.body).toHaveTextContent("Private unsaved text");
  expect(JSON.stringify(history.state)).not.toContain("Private unsaved text");
});
it("warns before unloading unsaved team role changes and cleans up handlers", () => {
  remove = installSettingsNavigationGuard();
  dirty();
  const first = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);
  remove();
  remove = undefined;
  const next = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(next);
  expect(next.defaultPrevented).toBe(false);
});
it('protects a customer reply on router changes without storing its text', () => {
  history.replaceState({}, '', '/portal?section=notifications&enquiryId=one');
  remove=installSettingsNavigationGuard();
  const form=document.createElement('section');
  form.dataset.messageDirty='true';
  form.textContent='Private customer reply';
  document.body.append(form);
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  history.pushState({},'', '/portal?section=cars');
  expect(location.search).toContain('enquiryId=one');
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('customer message or note'));
  expect(JSON.stringify(history.state)).not.toContain('Private customer reply');
  const unload=new Event('beforeunload',{cancelable:true});
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  confirm.mockReturnValue(true);
  expect(confirmSettingsNavigation()).toBe(true);
  history.pushState({},'', '/portal?section=cars');
  expect(location.search).toBe('?section=cars');
  expect(confirm).toHaveBeenCalledTimes(2);
});
