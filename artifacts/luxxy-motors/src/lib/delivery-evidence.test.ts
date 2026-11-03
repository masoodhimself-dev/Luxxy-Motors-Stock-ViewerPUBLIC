import { afterEach, expect, it, vi } from "vitest";
import { deliveryLocalDraft } from "./delivery-evidence";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("does not leave the driver waiting forever for blocked device storage", async () => {
  vi.useFakeTimers();
  const close = vi.fn();
  const request: any = { result: { close } };
  vi.stubGlobal("indexedDB", { open: () => request });
  const load = deliveryLocalDraft("job-key");
  const rejected = expect(load).rejects.toThrow(
    "Device storage did not respond",
  );
  await vi.advanceTimersByTimeAsync(4000);
  await rejected;
  request.onsuccess();
  expect(close).toHaveBeenCalledTimes(1);
});

it("handles a blocked open without reading the pending request error property", async () => {
  const request: any = {};
  Object.defineProperty(request, "error", {
    get() {
      throw new DOMException("Still pending", "InvalidStateError");
    },
  });
  vi.stubGlobal("indexedDB", { open: () => request });
  const load = deliveryLocalDraft("job-key");
  request.onblocked();
  await expect(load).rejects.toThrow("Device storage is unavailable");
});
